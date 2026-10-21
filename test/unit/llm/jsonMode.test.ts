import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  ContentFilterError,
  LLMError,
  OutputTruncatedError,
  QuotaExceededError,
  StructuredOutputError,
} from "../../../src/core/errors";
import type {
  HttpClient,
  HttpMethod,
  HttpOptions,
  HttpResponse,
} from "../../../src/core/http/client";
import { isRetriedAutomatically } from "../../../src/core/http/retry";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { SecretId, SecretStore } from "../../../src/core/secretStore";
import { createAnthropicProvider } from "../../../src/llm/anthropic/anthropicProvider";
import { createGeminiProvider } from "../../../src/llm/gemini/geminiProvider";
import { createOpenAiProvider } from "../../../src/llm/openai/openAiProvider";
import { createOpenRouterProvider } from "../../../src/llm/openrouter/openRouterProvider";
import { createBaseUrlResolver } from "../../../src/llm/shared/baseUrl";
import {
  buildRepairRequest,
  completeJSON,
  parseOrRepair,
  REPAIR_SYSTEM_PROMPT,
  SCHEMA_APPEND_HEADING,
  SCHEMA_APPEND_INSTRUCTION,
  stripCodeFence,
  type StructuredRequest,
  tryParseJson,
  withSchemaInPrompt,
} from "../../../src/llm/shared/jsonMode";
import {
  type JsonSchema,
  schemaProblems,
  validateAgainstSchema,
} from "../../../src/llm/shared/schemaValidate";
import type {
  ChatRequest,
  LLMCallContext,
  LLMProvider,
} from "../../../src/llm/types";
import type { ProviderId } from "../../../src/model/ids";
import { PROMPT_SCHEMAS } from "../../../src/prompts";
import {
  chatResponse,
  mockLLM,
  mockLLMRouter,
  mockSettings,
} from "../../helpers/mockLLM";

/**
 * `P3-T12`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * model and no real key.
 *
 * **Every fixture below is SYNTHETIC**, hand-built from the shapes `docs/03`
 * records (§2.4 OpenAI, §3.4 Anthropic, §4.4 Gemini, §5.4 OpenRouter, §9.4 the
 * OpenRouter catalogue) and from `docs/13` §3.1's description of
 * `chat-json-malformed` ("a response that *nearly* matches the schema
 * (trailing prose, code fences)"). Recorded fixtures are `P3-T30`'s. Keys are
 * built at run time and live only in the memory keystore below.
 *
 * **The `PaperSummary` v1 example is hand-built too.** The corpus has no
 * canonical example object (`docs/06` §6.2 and `docs/12` §4 give the schema
 * only), so {@link paperSummary} is one written against the schema, with
 * every required field and the optional ones exercised.
 */

const PAPER_SUMMARY = PROMPT_SCHEMAS["paper-summary.v1.json"] as JsonSchema;

/** A `PaperSummary` v1 object, valid against the shipped schema. SYNTHETIC. */
function paperSummary(): Record<string, unknown> {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey: "ABCD2345",
    sourceTier: "abstract",
    confidence: "high",
    researchQuestion:
      "Does drug X reduce 30-day mortality in adults with septic shock?",
    studyDesign: {
      label: "randomized_controlled_trial",
      detail: "Double-blind, placebo-controlled, two arms, 12 centres",
    },
    population: {
      kind: "human",
      description: "Adults with septic shock admitted to 12 ICUs",
      size: "n = 1,204 (612 treatment / 592 control)",
    },
    methods: ["Cox proportional hazards model", "intention-to-treat analysis"],
    keyFindings: [
      {
        statement: "Drug X lowered 30-day mortality compared with placebo.",
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport: "30-day mortality was lower in the drug X arm",
      },
    ],
    effectSizes: [
      {
        metric: "hazard ratio",
        value: "0.62 (95% CI 0.48-0.79)",
        comparison: "drug X vs placebo",
        pValue: "p < 0.001",
        unit: null,
      },
    ],
    limitations: ["Not stated by authors: single-country recruitment"],
    novelty: null,
    keywords: ["septic shock", "mortality"],
    researchTheme: "Sepsis Pharmacotherapy",
    citationWorthiness: { score: 78, reason: "Large, well-reported trial." },
    openQuestions: [],
    contradictsOrChallenges: null,
    notEnoughInformation: [],
  };
}

const VALID_TEXT = JSON.stringify(paperSummary());

/** `docs/13` §3.1's `chat-json-malformed`: code fences and trailing prose around a valid object. */
const MALFORMED_TEXT = [
  "Here is the summary you asked for:",
  "```json",
  JSON.stringify(paperSummary(), null, 2),
  "```",
  "Let me know if you need anything else.",
].join("\n");

/** Schema-violating: a bad `studyDesign.label` and an extra property. */
function violatingText(): string {
  const bad = paperSummary();
  bad.studyDesign = { label: "a_very_good_trial", detail: null };
  bad.mood = "upbeat";
  return JSON.stringify(bad);
}

/** A `then` handler for a promise that must reject. */
function unexpected(): never {
  throw new Error("expected the call to throw");
}

function ctx(): LLMCallContext {
  return { token: createCancellationTokenSource().token };
}

function structured(
  overrides: Partial<StructuredRequest> = {},
): StructuredRequest {
  return {
    model: "mock-small",
    messages: [
      { role: "system", content: "You summarize biomedical papers." },
      { role: "user", content: "Summarize the paper below." },
    ],
    maxOutputTokens: 1200,
    temperature: 0.3,
    effort: "low",
    routing: { requireZeroRetention: true },
    traceId: "trace-1",
    responseFormat: {
      kind: "json_schema",
      name: "paper_summary",
      schema: PAPER_SUMMARY,
    },
    ...overrides,
  };
}

// ===========================================================================
// 1. The validator (step 2)
// ===========================================================================

describe("validateAgainstSchema over PaperSummary v1 (P3-T12 step 2)", () => {
  it("accepts the PaperSummary v1 example", () => {
    expect(validateAgainstSchema(paperSummary(), PAPER_SUMMARY)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("rejects an extra property, at the top level and inside a nested object", () => {
    const top = { ...paperSummary(), mood: "upbeat" };
    expect(validateAgainstSchema(top, PAPER_SUMMARY).errors).toEqual([
      '/: property "mood" is not allowed',
    ]);
    const nested = paperSummary();
    nested.citationWorthiness = { score: 50, reason: "ok", extra: 1 };
    expect(validateAgainstSchema(nested, PAPER_SUMMARY).errors).toEqual([
      '/citationWorthiness: property "extra" is not allowed',
    ]);
  });

  it("rejects a studyDesign label outside the enum, and accepts its null", () => {
    const bad = paperSummary();
    bad.studyDesign = { label: "a_very_good_trial", detail: null };
    const result = validateAgainstSchema(bad, PAPER_SUMMARY);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^\/studyDesign\/label: must be one of /);
    const nulled = paperSummary();
    nulled.studyDesign = { label: null, detail: null };
    expect(validateAgainstSchema(nulled, PAPER_SUMMARY).ok).toBe(true);
  });

  it("rejects a missing required field, top level and nested", () => {
    const top = paperSummary();
    delete top.keywords;
    expect(validateAgainstSchema(top, PAPER_SUMMARY).errors).toEqual([
      '/: missing required property "keywords"',
    ]);
    const nested = paperSummary();
    nested.population = { kind: "human", description: null };
    expect(validateAgainstSchema(nested, PAPER_SUMMARY).errors).toEqual([
      '/population: missing required property "size"',
    ]);
  });

  it("checks const, pattern, integer, minimum/maximum, maxItems and nested item types", () => {
    const bad = paperSummary();
    bad.schemaVersion = "paper-summary-v2";
    bad.itemKey = "abcd2345";
    bad.citationWorthiness = { score: 100.5, reason: "x" };
    bad.methods = Array.from({ length: 11 }, (_, i) => `method ${i}`);
    bad.keyFindings = [
      { ...(paperSummary().keyFindings as object[])[0], direction: 3 },
    ];
    const errors = validateAgainstSchema(bad, PAPER_SUMMARY).errors;
    expect(errors).toEqual([
      '/schemaVersion: must equal "paper-summary-v1"',
      "/itemKey: does not match the pattern ^[A-Z0-9]{8}$",
      "/methods: more than 10 items (11)",
      "/keyFindings/0/direction: expected type string, got integer",
      "/citationWorthiness/score: expected type integer, got number",
    ]);
    const high = paperSummary();
    high.citationWorthiness = { score: 101, reason: "x" };
    expect(validateAgainstSchema(high, PAPER_SUMMARY).errors).toEqual([
      "/citationWorthiness/score: above the maximum 100",
    ]);
    const low = paperSummary();
    low.citationWorthiness = { score: -1, reason: "x" };
    expect(validateAgainstSchema(low, PAPER_SUMMARY).errors).toEqual([
      "/citationWorthiness/score: below the minimum 0",
    ]);
  });

  it("counts maxLength in code points, not UTF-16 units", () => {
    const atLimit = paperSummary();
    atLimit.researchTheme = "\u{1F9EA}".repeat(80); // 80 code points, 160 units
    expect(validateAgainstSchema(atLimit, PAPER_SUMMARY).ok).toBe(true);
    const over = paperSummary();
    over.researchTheme = "\u{1F9EA}".repeat(81);
    expect(validateAgainstSchema(over, PAPER_SUMMARY).errors).toEqual([
      "/researchTheme: longer than 80 characters (81)",
    ]);
  });

  it("rejects a non-object answer at the root", () => {
    expect(
      validateAgainstSchema([paperSummary()], PAPER_SUMMARY).errors,
    ).toEqual(["/: expected type object, got array"]);
  });

  it("never quotes a string value the model sent in an error line", () => {
    const bad = paperSummary();
    bad.researchQuestion = `SECRET-PAPER-TEXT ${"x".repeat(400)}`;
    const [line] = validateAgainstSchema(bad, PAPER_SUMMARY).errors;
    expect(line).toBe("/researchQuestion: longer than 400 characters (418)");
  });

  it("refuses a schema outside the supported subset with ConfigurationError, not a pass", () => {
    const withRef = { type: "object", properties: { a: { $ref: "#/x" } } };
    expect(schemaProblems(withRef)).toEqual([
      '/properties/a: unsupported keyword "$ref"',
    ]);
    expect(() => validateAgainstSchema({ a: 1 }, withRef)).toThrow(
      ConfigurationError,
    );
    expect(() =>
      validateAgainstSchema("x", { type: "string", oneOf: [] }),
    ).toThrow(ConfigurationError);
    expect(schemaProblems({ type: "string", pattern: "(" })).toEqual([
      "/pattern: not a valid regular expression",
    ]);
    expect(schemaProblems({ type: "text" })).toEqual([
      "/type: not a type name or a list of type names",
    ]);
  });

  it("accepts docs/12 §3's RelevanceScreen schema, booleans included", () => {
    const relevance: JsonSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "RelevanceScreen",
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "score",
              "reason",
              "confidence",
              "isPrimaryResearch",
            ],
            properties: {
              id: { type: "string" },
              score: { type: "integer", minimum: 0, maximum: 100 },
              reason: { type: "string", maxLength: 300 },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              isPrimaryResearch: { type: "boolean" },
              flags: {
                type: "array",
                items: { type: "string", enum: ["no_abstract"] },
              },
            },
          },
        },
      },
    };
    expect(schemaProblems(relevance)).toEqual([]);
    const row = {
      id: "c1",
      score: 40,
      reason: "r",
      confidence: "low",
      isPrimaryResearch: false,
      flags: ["no_abstract"],
    };
    expect(validateAgainstSchema({ results: [row] }, relevance).ok).toBe(true);
    expect(
      validateAgainstSchema(
        { results: [{ ...row, isPrimaryResearch: "no" }] },
        relevance,
      ).errors,
    ).toEqual([
      "/results/0/isPrimaryResearch: expected type boolean, got string",
    ]);
  });
});

// ===========================================================================
// 2. The fence stripper and the brace extractor
// ===========================================================================

describe("stripCodeFence and tryParseJson (docs/03 §14.5, docs/12 §18.3)", () => {
  it("strips a ```json fence, a bare fence, and a fence inside prose", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('Sure:\n```json\n{"a":1}\n```\nDone.')).toBe(
      '{"a":1}',
    );
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("parses the chat-json-malformed text to the object inside it", () => {
    expect(tryParseJson(MALFORMED_TEXT)).toEqual(paperSummary());
  });

  it("takes the outermost balanced object from prose, braces inside strings included", () => {
    const text = 'Result {draft}: {"a":"x } y {","b":{"c":[1,2]}} trailing';
    expect(tryParseJson(text)).toEqual({ a: "x } y {", b: { c: [1, 2] } });
    expect(tryParseJson('He said \\"hi\\" {"q":"a\\"}b"}')).toEqual({
      q: 'a"}b',
    });
  });

  it("returns undefined when nothing in the text parses", () => {
    expect(tryParseJson("I cannot summarize this.")).toBeUndefined();
    expect(tryParseJson("")).toBeUndefined();
    expect(tryParseJson('{"a": 1')).toBeUndefined();
  });
});

// ===========================================================================
// 3. completeJSON's bound: one repair, one retry, then fail (steps 3–5)
// ===========================================================================

describe("completeJSON: one repair, one full retry at temperature 0, then fail (P3-T12 steps 3–5)", () => {
  it("returns a valid first answer after exactly one call", async () => {
    const llm = mockLLM([chatResponse(VALID_TEXT)]);
    const done = await completeJSON(llm, structured(), ctx());
    expect(done.value).toEqual(paperSummary());
    expect(done.outcome).toBe("direct");
    expect(llm.calls).toHaveLength(1);
    expect(done.calls).toBe(1);
  });

  it("repairs a schema-violating answer with one docs/12 §18.3 repair call", async () => {
    const llm = mockLLM([
      chatResponse(violatingText()),
      chatResponse(VALID_TEXT),
    ]);
    const done = await completeJSON(llm, structured(), ctx());
    expect(done.outcome).toBe("repaired");
    expect(done.value).toEqual(paperSummary());
    expect(llm.calls).toHaveLength(2);

    const repair = llm.calls[1]?.request as ChatRequest;
    expect(repair.model).toBe("mock-small");
    expect(repair.temperature).toBe(0);
    expect(repair.responseFormat).toBeUndefined();
    expect(repair.messages[0]).toEqual({
      role: "system",
      content: REPAIR_SYSTEM_PROMPT,
    });
    const user = repair.messages[1]?.content ?? "";
    expect(user).toContain("ERRORS:\n/studyDesign/label: must be one of ");
    expect(user).toContain('/: property "mood" is not allowed');
    expect(user).toContain(`SCHEMA:\n${JSON.stringify(PAPER_SUMMARY)}`);
    expect(user).toContain(`MALFORMED OUTPUT:\n${violatingText()}`);
    // A repair keeps the original's privacy routing, effort, limit and trace id.
    expect(repair.routing).toEqual({ requireZeroRetention: true });
    expect(repair.effort).toBe("low");
    expect(repair.maxOutputTokens).toBe(1200);
    expect(repair.traceId).toBe("trace-1");
  });

  it("makes exactly one repair and one retry, and the third failure throws StructuredOutputError with providerId and modelId", async () => {
    const llm = mockLLM([chatResponse(violatingText())], { id: "anthropic" });
    const failure = await completeJSON(llm, structured(), ctx()).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(StructuredOutputError);
    const error = failure as StructuredOutputError;
    expect(error.providerId).toBe("anthropic");
    expect(error.modelId).toBe("mock-small");
    expect(error.context.requests).toBe(3);
    expect(llm.calls).toHaveLength(3);

    // Call 2 is the repair; call 3 is the original again, at temperature 0.
    expect(llm.calls[1]?.request.messages[0]?.content).toBe(
      REPAIR_SYSTEM_PROMPT,
    );
    const retry = llm.calls[2]?.request;
    expect(retry).toEqual({ ...structured(), temperature: 0 });
  });

  it("returns the retry's answer when the repair fails and the retry is valid", async () => {
    const llm = mockLLM([
      chatResponse(violatingText()),
      chatResponse("still not JSON"),
      chatResponse(MALFORMED_TEXT),
    ]);
    const done = await completeJSON(llm, structured(), ctx());
    expect(done.outcome).toBe("retried");
    expect(done.calls).toBe(3);
    expect(done.value).toEqual(paperSummary());
  });

  it("throws on a truncated answer (finishReason length) before any repair", async () => {
    const llm = mockLLM([
      chatResponse(VALID_TEXT.slice(0, 200), { finishReason: "length" }),
    ]);
    const failure = await completeJSON(llm, structured(), ctx()).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(LLMError);
    expect(failure).not.toBeInstanceOf(StructuredOutputError);
    expect((failure as LLMError).providerId).toBe("openrouter");
    expect((failure as LLMError).context.finishReason).toBe("length");
    expect(llm.calls).toHaveLength(1);
  });

  it("throws a truncation as OutputTruncatedError, whose user-facing message is the cut-off one, not rh-error-llm (item 265(c))", async () => {
    const llm = mockLLM([
      chatResponse(VALID_TEXT.slice(0, 200), { finishReason: "length" }),
    ]);
    const failure = await completeJSON(llm, structured(), ctx()).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(OutputTruncatedError);
    const cut = failure as OutputTruncatedError;
    expect(cut.messageKey).toBe("rh-error-output-truncated");
    expect(cut.userFacing).toBe(true);
    expect(cut.modelId).toBe(structured().model);
    // Never re-sent: the same request would be cut off again.
    expect(isRetriedAutomatically(cut)).toBe(false);
    expect(llm.calls).toHaveLength(1);
  });

  it("throws ContentFilterError with zero repairs: an adapter-thrown refusal, and a content_filter stop", async () => {
    const thrown = mockLLM([
      new ContentFilterError("openrouter", "mock-small", "declined"),
    ]);
    await expect(completeJSON(thrown, structured(), ctx())).rejects.toThrow(
      ContentFilterError,
    );
    expect(thrown.calls).toHaveLength(1);

    const stopped = mockLLM([
      chatResponse("", { finishReason: "content_filter" }),
    ]);
    await expect(completeJSON(stopped, structured(), ctx())).rejects.toThrow(
      ContentFilterError,
    );
    expect(stopped.calls).toHaveLength(1);
  });

  it("does not retry a refusal on the repair, nor a truncation on the retry", async () => {
    const refusedRepair = mockLLM([
      chatResponse(violatingText()),
      chatResponse("", { finishReason: "content_filter" }),
    ]);
    await expect(
      completeJSON(refusedRepair, structured(), ctx()),
    ).rejects.toThrow(ContentFilterError);
    expect(refusedRepair.calls).toHaveLength(2);

    const truncatedRetry = mockLLM([
      chatResponse(violatingText()),
      chatResponse("nope"),
      chatResponse("{", { finishReason: "length" }),
    ]);
    const failure = await completeJSON(
      truncatedRetry,
      structured(),
      ctx(),
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(OutputTruncatedError);
    expect(failure).not.toBeInstanceOf(StructuredOutputError);
    expect(truncatedRetry.calls).toHaveLength(3);
  });

  it("lets any other error from chat() through unrepaired", async () => {
    const llm = mockLLM([new QuotaExceededError(402, "spend cap", {})]);
    await expect(completeJSON(llm, structured(), ctx())).rejects.toThrow(
      QuotaExceededError,
    );
    expect(llm.calls).toHaveLength(1);
  });

  it("sums usage over every request, and leaves a field unknown when one answer lacks it", async () => {
    const usage = (cost: number | undefined) => ({
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      costUsd: cost,
    });
    const known = mockLLM([
      chatResponse(violatingText(), { usage: usage(0.01) }),
      chatResponse(VALID_TEXT, { usage: usage(0.02) }),
    ]);
    const done = await completeJSON(known, structured(), ctx());
    expect(done.usage.inputTokens).toBe(200);
    expect(done.usage.totalTokens).toBe(220);
    expect(done.usage.costUsd).toBeCloseTo(0.03, 10);

    const partly = mockLLM([
      chatResponse(violatingText(), { usage: usage(0.01) }),
      chatResponse(VALID_TEXT, { usage: usage(undefined) }),
    ]);
    expect(
      (await completeJSON(partly, structured(), ctx())).usage.costUsd,
    ).toBe(undefined);
  });

  it("refuses, with zero requests, a request that is not json_schema or a schema outside the subset", async () => {
    const llm = mockLLM([chatResponse(VALID_TEXT)]);
    const plain = {
      ...structured(),
      responseFormat: { kind: "text" },
    } as unknown as StructuredRequest;
    await expect(completeJSON(llm, plain, ctx())).rejects.toThrow(
      ConfigurationError,
    );
    const unsupported = structured({
      responseFormat: {
        kind: "json_schema",
        name: "x",
        schema: { type: "object", anyOf: [] },
      },
    });
    await expect(completeJSON(llm, unsupported, ctx())).rejects.toThrow(
      ConfigurationError,
    );
    expect(llm.calls).toHaveLength(0);
  });

  it("attributes the failure to the router's active provider", async () => {
    const provider = mockLLM([chatResponse("no json here")], { id: "gemini" });
    const router = mockLLMRouter(
      [provider],
      mockSettings({
        activeProvider: "gemini",
        keyPresent: { gemini: true },
      }),
    );
    const failure = await completeJSON(router, structured(), ctx()).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(StructuredOutputError);
    expect((failure as StructuredOutputError).providerId).toBe("gemini");
    expect(provider.calls).toHaveLength(3);
  });

  it("keeps the model's output out of the error unless asked, and redacts it when asked", async () => {
    const key = ["sk", "proj", "Q".repeat(30)].join("-");
    const leaky = `{"note":"${key}"`;
    const quiet = await completeJSON(
      mockLLM([chatResponse(leaky)]),
      structured(),
      ctx(),
    ).then(unexpected, (e: unknown) => e as StructuredOutputError);
    expect(quiet.context.raw).toBeUndefined();
    expect(quiet.context.rawLength).toBe(leaky.length);
    expect(quiet.context.errors).toEqual(["not valid JSON"]);
    expect(JSON.stringify(quiet.context)).not.toContain(key);

    const loud = await completeJSON(
      mockLLM([chatResponse(leaky)]),
      structured(),
      ctx(),
      { includeBodies: true },
    ).then(unexpected, (e: unknown) => e as StructuredOutputError);
    expect(loud.context.raw).toContain("[redacted:");
    expect(JSON.stringify(loud.context)).not.toContain(key);
    expect(JSON.stringify(loud.toSerialized())).not.toContain(key);
  });

  it("is never re-sent by the transport: StructuredOutputError stays outside the retry set (P3-T38)", () => {
    const error = new StructuredOutputError("openai", "m", "x");
    expect(error.retryable).toBe(true);
    expect(isRetriedAutomatically(error)).toBe(false);
  });
});

describe("parseOrRepair (docs/12 §18.3)", () => {
  it("returns valid raw text with no request at all", async () => {
    const llm = mockLLM([chatResponse(VALID_TEXT)]);
    const out = await parseOrRepair(MALFORMED_TEXT, structured(), llm, ctx());
    expect(out.value).toEqual(paperSummary());
    expect(out.repair).toBeUndefined();
    expect(llm.calls).toHaveLength(0);
  });

  it("makes one repair, and throws the four-argument StructuredOutputError when it fails", async () => {
    const llm = mockLLM([chatResponse("still wrong")], { id: "openai" });
    const failure = await parseOrRepair("nope", structured(), llm, ctx()).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(StructuredOutputError);
    expect((failure as StructuredOutputError).providerId).toBe("openai");
    expect((failure as StructuredOutputError).modelId).toBe("mock-small");
    expect((failure as StructuredOutputError).message).toBe(
      "JSON repair failed",
    );
    expect(llm.calls).toHaveLength(1);
  });

  it("tells the repair the text was not JSON when it did not parse", () => {
    const repair = buildRepairRequest(structured(), "nope", ["not valid JSON"]);
    expect(repair.messages[1]?.content).toContain("ERRORS:\nnot valid JSON\n");
  });
});

// ===========================================================================
// 4. The prompt-append fallback (step 6)
// ===========================================================================

describe("withSchemaInPrompt: the prompt-append fallback (P3-T12 step 6)", () => {
  it("moves the schema into the last user message and leaves the system message alone", () => {
    const original = structured();
    const coerced = withSchemaInPrompt(original);
    expect(coerced.responseFormat).toEqual({ kind: "json" });
    expect(coerced.messages[0]).toEqual(original.messages[0]);
    expect(coerced.messages[1]?.content).toBe(
      [
        "Summarize the paper below.",
        "",
        SCHEMA_APPEND_HEADING,
        SCHEMA_APPEND_INSTRUCTION,
        "",
        "SCHEMA:",
        JSON.stringify(PAPER_SUMMARY),
      ].join("\n"),
    );
    // The input is not mutated.
    expect(original.messages[1]?.content).toBe("Summarize the paper below.");
  });

  it("adds a user message when there is none, and leaves a non-schema request unchanged", () => {
    const systemOnly = structured({
      messages: [{ role: "system", content: "S" }],
    });
    const coerced = withSchemaInPrompt(systemOnly);
    expect(coerced.messages).toHaveLength(2);
    expect(coerced.messages[1]?.role).toBe("user");
    const text: ChatRequest = {
      ...structured(),
      responseFormat: { kind: "text" },
    };
    expect(withSchemaInPrompt(text)).toBe(text);
  });
});

// ===========================================================================
// 5. The four adapters: native field, and chat-json-malformed (steps 1, 6)
// ===========================================================================

interface SentRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly body: unknown;
}

/** A fake shared client: answers by URL and records what was sent. */
function fakeHttp(
  answer: (method: HttpMethod, url: string) => unknown,
): HttpClient & { readonly sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  return {
    sent,
    request(
      method: HttpMethod,
      url: string,
      options?: HttpOptions,
    ): Promise<HttpResponse> {
      sent.push({
        method,
        url,
        body:
          options?.body === undefined
            ? undefined
            : (JSON.parse(options.body) as unknown),
      });
      return Promise.resolve({
        status: 200,
        url,
        body: JSON.stringify(answer(method, url)),
        rawHeaders: "",
        header: () => undefined,
      });
    },
  };
}

/** A memory keystore holding one run-time-built key per LLM provider. */
function keystore(): SecretStore {
  const values = new Map<SecretId, string>(
    (
      ["llm.openrouter", "llm.openai", "llm.anthropic", "llm.gemini"] as const
    ).map((id) => [id, ["synthetic", id, "k".repeat(24)].join("-")]),
  );
  return {
    backend: "os-keychain",
    unattended: true,
    get: (id) => Promise.resolve(values.get(id)),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    has: (id) => Promise.resolve(values.has(id)),
    listStoredIds: () => Promise.resolve([...values.keys()]),
    clearAll: () => Promise.resolve(0),
  };
}

const baseUrls = createBaseUrlResolver({ override: () => "" });

/** Each provider's `chat-json-malformed` answer body. SYNTHETIC. */
const MALFORMED_BODIES: Readonly<Record<ProviderId, unknown>> = {
  // `docs/03` §5.4.
  openrouter: {
    id: "gen-synthetic",
    model: "mock-small",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: MALFORMED_TEXT },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  },
  // `docs/03` §2.4.
  openai: {
    id: "resp_synthetic",
    object: "response",
    status: "completed",
    model: "mock-small",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: MALFORMED_TEXT }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    incomplete_details: null,
  },
  // `docs/03` §3.4.
  anthropic: {
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "mock-small",
    content: [{ type: "text", text: MALFORMED_TEXT }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  // `docs/03` §4.4.
  gemini: {
    id: "int_synthetic",
    object: "interaction",
    model: "mock-small",
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [{ type: "text", text: MALFORMED_TEXT }],
      },
    ],
    usage: {
      total_input_tokens: 10,
      total_output_tokens: 5,
      total_tokens: 15,
    },
  },
};

function adapter(id: ProviderId, http: HttpClient): LLMProvider {
  const deps = { secrets: keystore(), baseUrls, http };
  switch (id) {
    case "openrouter":
      return createOpenRouterProvider(deps);
    case "openai":
      return createOpenAiProvider(deps);
    case "anthropic":
      return createAnthropicProvider(deps);
    case "gemini":
      return createGeminiProvider(deps);
  }
}

/** Where each adapter puts a `json_schema` request on the wire (`docs/03` §7.5). */
function nativeSchemaOf(id: ProviderId, body: unknown): unknown {
  const b = body as Record<string, Record<string, Record<string, unknown>>>;
  switch (id) {
    case "openrouter":
      return b.response_format?.json_schema?.schema;
    case "openai":
      return b.text?.format?.schema;
    case "anthropic":
      return b.output_config?.format?.schema;
    case "gemini":
      return b.response_format?.schema;
  }
}

describe("each provider's chat-json-malformed answer, through the real adapter (P3-T12 steps 1 and 3)", () => {
  it.each(["openrouter", "openai", "anthropic", "gemini"] as const)(
    "%s: sends the schema in its native field, and the fenced answer parses through the fence stripper with no repair",
    async (id) => {
      const http = fakeHttp(() => MALFORMED_BODIES[id]);
      const provider = adapter(id, http);

      const done = await completeJSON(provider, structured(), ctx());

      expect(done.value).toEqual(paperSummary());
      expect(done.outcome).toBe("direct");
      expect(done.response.json).toBeUndefined(); // the adapter alone cannot read it
      expect(http.sent).toHaveLength(1);
      expect(nativeSchemaOf(id, http.sent[0]?.body)).toEqual(PAPER_SUMMARY);
    },
  );
});

describe("the OpenRouter adapter's prompt-append fallback (P3-T12 step 6)", () => {
  /** `docs/03` §9.4's catalogue: one schema-capable model, one not. SYNTHETIC. */
  const CATALOGUE = {
    data: [
      {
        id: "test/capable",
        context_length: 32000,
        pricing: { prompt: "0.000001", completion: "0.000002" },
        top_provider: { context_length: 32000, max_completion_tokens: 4000 },
        supported_parameters: ["response_format", "structured_outputs"],
      },
      {
        id: "test/plain",
        context_length: 32000,
        pricing: { prompt: "0.000001", completion: "0.000002" },
        top_provider: { context_length: 32000, max_completion_tokens: 4000 },
        supported_parameters: ["max_tokens"],
      },
    ],
  };

  function harness(): {
    provider: LLMProvider;
    http: ReturnType<typeof fakeHttp>;
  } {
    const http = fakeHttp((method) =>
      method === "GET" ? CATALOGUE : MALFORMED_BODIES.openrouter,
    );
    return { provider: adapter("openrouter", http), http };
  }

  it("puts the schema in the prompt, and sends neither response_format nor require_parameters, for a model the catalogue lists without structured outputs", async () => {
    const { provider, http } = harness();
    await provider.listModels(ctx());
    const done = await completeJSON(
      provider,
      structured({ model: "test/plain" }),
      ctx(),
    );
    expect(done.value).toEqual(paperSummary());

    const body = http.sent[1]?.body as {
      response_format?: unknown;
      provider: Record<string, unknown>;
      messages: { role: string; content: string }[];
    };
    expect(body.response_format).toBeUndefined();
    expect(body.provider.require_parameters).toBeUndefined();
    expect(body.provider.data_collection).toBe("deny");
    expect(body.messages[0]?.content).toBe("You summarize biomedical papers.");
    expect(body.messages[1]?.content).toContain(
      `${SCHEMA_APPEND_HEADING}\n${SCHEMA_APPEND_INSTRUCTION}`,
    );
    expect(body.messages[1]?.content).toContain(JSON.stringify(PAPER_SUMMARY));
  });

  it("keeps the native field for a schema-capable model, and before any catalogue is fetched", async () => {
    const { provider, http } = harness();
    await completeJSON(provider, structured({ model: "test/plain" }), ctx());
    const before = http.sent[0]?.body as Record<
      string,
      Record<string, unknown>
    >;
    expect(before.provider?.require_parameters).toBe(true);
    expect(before.response_format).toBeDefined();

    await provider.listModels(ctx());
    await completeJSON(provider, structured({ model: "test/capable" }), ctx());
    const capable = http.sent[2]?.body as {
      response_format?: unknown;
      messages: { content: string }[];
    };
    expect(capable.response_format).toBeDefined();
    expect(capable.messages[1]?.content).toBe("Summarize the paper below.");
  });
});

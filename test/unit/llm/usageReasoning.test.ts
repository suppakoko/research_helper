/**
 * `P4-T23` step 4's data source at the adapters: `Usage.reasoningTokens` is read
 * where a provider's answer holds a figure and stays absent where it does not
 * (`docs/07` §5.2's note of 2026-11-02, item 6), and `ChatRequest.accounting` is
 * never sent upstream.
 *
 * **What the fixtures can and cannot prove.** The only usage blocks under
 * `test/fixtures/llm` are four synthetic refusals, and none holds a reasoning
 * figure, so they prove "absent stays absent". The figures below are hand-written
 * in the documented shapes: `docs/03` §2.6 and §14.2 (OpenAI), `docs/03` §4.4
 * (Gemini), and OpenRouter's usage-accounting page as read on 2026-11-02.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no network, no key, no model.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  toMessagesBody,
  toUsage as anthropicUsage,
} from "../../../src/llm/anthropic/mapper";
import {
  buildGenerateContentBody,
  buildInteractionBody,
  readGenerateContent,
  readInteraction,
} from "../../../src/llm/gemini/mapper";
import {
  buildResponsesBody,
  extractUsage,
} from "../../../src/llm/openai/mapper";
import {
  toOpenRouterBody,
  toUsage as openRouterUsage,
} from "../../../src/llm/openrouter/mapper";
import type { ChatRequest, Usage } from "../../../src/llm/types";

const here = dirname(fileURLToPath(import.meta.url));

function fixtureBody(provider: string): Record<string, unknown> {
  const file = resolve(here, `../../fixtures/llm/${provider}/refusal.json`);
  const recorded = JSON.parse(readFileSync(file, "utf8")) as {
    readonly body: unknown;
  };
  return (
    typeof recorded.body === "string"
      ? JSON.parse(recorded.body)
      : recorded.body
  ) as Record<string, unknown>;
}

const REQUEST: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "hello" }],
  maxOutputTokens: 10,
  traceId: "t",
  accounting: { promptId: "THEME_CLUSTER", papers: 7 },
};

/** An Interactions answer's usage, read through the adapter's own reader. */
function interactionUsage(usage: Record<string, unknown>): Usage {
  const reading = readInteraction({ status: "completed", usage }, REQUEST);
  if ("refused" in reading) throw new Error("refused");
  return reading.usage;
}

describe("a recorded fixture with no reasoning figure stays absent, never 0", () => {
  it("OpenAI", () => {
    const usage = extractUsage(fixtureBody("openai"));
    expect(usage.inputTokens).toBe(20);
    expect(usage).not.toHaveProperty("reasoningTokens");
  });

  it("OpenRouter", () => {
    const usage = openRouterUsage(fixtureBody("openrouter")["usage"]);
    expect(usage.inputTokens).toBe(20);
    expect(usage).not.toHaveProperty("reasoningTokens");
  });

  it("Anthropic", () => {
    const usage = anthropicUsage(fixtureBody("anthropic")["usage"]);
    expect(usage.inputTokens).toBe(20);
    expect(usage).not.toHaveProperty("reasoningTokens");
  });

  it("Gemini, whose fixture is the legacy shape", () => {
    const { usage } = readGenerateContent(fixtureBody("gemini"), REQUEST);
    expect(usage.inputTokens).toBe(20);
    expect(usage).not.toHaveProperty("reasoningTokens");
  });
});

describe("the documented figure is read, beside the output and not taken from it", () => {
  it("OpenAI: output_tokens_details.reasoning_tokens", () => {
    expect(
      extractUsage({
        usage: {
          input_tokens: 412,
          output_tokens: 118,
          total_tokens: 530,
          output_tokens_details: { reasoning_tokens: 64 },
        },
      }),
    ).toStrictEqual({
      inputTokens: 412,
      outputTokens: 118,
      totalTokens: 530,
      costUsd: undefined,
      reasoningTokens: 64,
    });
  });

  it("OpenRouter: completion_tokens_details.reasoning_tokens, with cost", () => {
    expect(
      openRouterUsage({
        prompt_tokens: 412,
        completion_tokens: 118,
        total_tokens: 530,
        cost: 0.00075,
        completion_tokens_details: { reasoning_tokens: 64 },
      }),
    ).toStrictEqual({
      inputTokens: 412,
      outputTokens: 118,
      totalTokens: 530,
      costUsd: 0.00075,
      reasoningTokens: 64,
    });
  });

  it("Gemini's Interactions answer: total_thought_tokens", () => {
    const usage = interactionUsage({
      total_input_tokens: 412,
      total_output_tokens: 118,
      total_thought_tokens: 44,
      total_tokens: 574,
    });
    expect(usage).toStrictEqual({
      inputTokens: 412,
      outputTokens: 118,
      totalTokens: 574,
      costUsd: undefined,
      reasoningTokens: 44,
    });
  });

  it("a reported 0 is kept: it is a measurement, not an absence", () => {
    expect(
      extractUsage({
        usage: { output_tokens_details: { reasoning_tokens: 0 } },
      }).reasoningTokens,
    ).toBe(0);
    expect(
      openRouterUsage({ completion_tokens_details: { reasoning_tokens: 0 } })
        .reasoningTokens,
    ).toBe(0);
  });

  it.each([["64"], [null], [Number.NaN], [{ n: 1 }]])(
    "a figure that is not a number (%j) stays absent",
    (bad) => {
      expect(
        extractUsage({
          usage: { output_tokens_details: { reasoning_tokens: bad } },
        }),
      ).not.toHaveProperty("reasoningTokens");
      expect(
        openRouterUsage({
          completion_tokens_details: { reasoning_tokens: bad },
        }),
      ).not.toHaveProperty("reasoningTokens");
      expect(
        interactionUsage({ total_thought_tokens: bad }),
      ).not.toHaveProperty("reasoningTokens");
    },
  );

  it("a details member that is not an object stays absent", () => {
    expect(
      openRouterUsage({ completion_tokens_details: "reasoning_tokens" }),
    ).not.toHaveProperty("reasoningTokens");
    expect(
      extractUsage({ usage: { output_tokens_details: 64 } }),
    ).not.toHaveProperty("reasoningTokens");
  });

  it("the two paths no document here names a figure for read none", () => {
    expect(
      anthropicUsage({
        input_tokens: 1,
        output_tokens: 2,
        reasoning_tokens: 9,
      }),
    ).not.toHaveProperty("reasoningTokens");
    expect(
      readGenerateContent(
        { usageMetadata: { promptTokenCount: 1, thoughtsTokenCount: 9 } },
        REQUEST,
      ).usage,
    ).not.toHaveProperty("reasoningTokens");
  });
});

describe("accounting is never sent upstream", () => {
  it.each<[string, () => unknown]>([
    ["OpenAI", () => buildResponsesBody(REQUEST)],
    [
      "OpenRouter",
      () => toOpenRouterBody(REQUEST, { privacyMode: "balanced" }),
    ],
    ["Anthropic", () => toMessagesBody(REQUEST, 10, "output_config")],
    ["Gemini Interactions", () => buildInteractionBody(REQUEST)],
    ["Gemini legacy", () => buildGenerateContentBody(REQUEST)],
  ])("%s", (_name, body) => {
    const sent = JSON.stringify(body());
    expect(sent).toContain("hello");
    expect(sent).not.toContain("THEME_CLUSTER");
    expect(sent).not.toContain("accounting");
  });
});

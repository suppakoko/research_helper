import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ContentFilterError,
  ContextLengthExceededError,
  QuotaExceededError,
  RateLimitError,
  type ResearchHelperError,
  StructuredOutputError,
  UpstreamServerError,
} from "../../../src/core/errors";
import {
  isRetriedAutomatically,
  retryPolicyFromBudget,
  withRetry,
} from "../../../src/core/http/retry";
import { LLM_RETRY_BUDGET } from "../../../src/core/rateLimit/hostLimiter";
import {
  mapProviderError,
  type ProviderHeaderLookup,
} from "../../../src/llm/shared/errorMap";
import type { ProviderId } from "../../../src/model/ids";

/**
 * `P3-T05`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * real time. Every body below is **hand-built** from the shapes `docs/03`
 * §2–§4, §11.1 and §11.5 record; none is a recorded live response, because
 * no live call may be made for this card (`plan/04` §0.2 item 6). `P3-T30`'s
 * recorded fixtures are where the real bodies arrive.
 */

/** A case-insensitive header lookup over a plain record. */
function headers(
  record: Readonly<Record<string, string>> = {},
): ProviderHeaderLookup {
  const byName = new Map(
    Object.entries(record).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return (name) => byName.get(name.toLowerCase());
}

const NOW = 1_700_000_000_000;
const MODEL = "test-model";

/** `mapProviderError` with no headers and the fixed clock reading. */
function map(
  providerId: ProviderId,
  status: number,
  body: unknown,
  head: Readonly<Record<string, string>> = {},
): ResearchHelperError | undefined {
  return mapProviderError(
    providerId,
    MODEL,
    status,
    headers(head),
    typeof body === "string" ? body : JSON.stringify(body),
    NOW,
  );
}

type ErrorClass = abstract new (...args: never[]) => ResearchHelperError;

interface Case {
  readonly provider: ProviderId;
  readonly category: string;
  readonly status: number;
  readonly body: unknown;
  readonly expected: ErrorClass;
}

const openaiError = (type: string, code: string | null, message = "x") => ({
  error: { message, type, param: null, code },
});
const anthropicError = (
  type: string,
  message = "x",
  details?: Record<string, string>,
) => ({
  type: "error",
  error: { type, message, ...(details !== undefined && { details }) },
});
const geminiError = (
  code: number,
  status: string,
  message = "x",
  reason?: string,
) => ({
  error: {
    code,
    message,
    status,
    ...(reason !== undefined && {
      details: [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason },
      ],
    }),
  },
});
const openrouterError = (code: number, message = "x") => ({
  error: { code, message },
});

/**
 * One hand-built body per provider per `docs/03` §11.5 category, each onto
 * the shipped class `docs/03` §14.1's authority note names for it.
 */
const CASES: readonly Case[] = [
  // auth
  {
    provider: "openai",
    category: "auth",
    status: 401,
    body: openaiError("invalid_request_error", "invalid_api_key"),
    expected: AuthenticationError,
  },
  {
    provider: "anthropic",
    category: "auth",
    status: 401,
    body: anthropicError("authentication_error"),
    expected: AuthenticationError,
  },
  {
    provider: "gemini",
    category: "auth",
    status: 400,
    body: geminiError(400, "INVALID_ARGUMENT", "x", "API_KEY_INVALID"),
    expected: AuthenticationError,
  },
  {
    provider: "gemini",
    category: "auth",
    status: 403,
    body: geminiError(403, "PERMISSION_DENIED"),
    expected: AuthorizationError,
  },
  {
    provider: "openrouter",
    category: "auth",
    status: 401,
    body: openrouterError(401),
    expected: AuthenticationError,
  },
  // bad_request
  {
    provider: "openai",
    category: "bad_request",
    status: 400,
    body: openaiError("invalid_request_error", null, "Unknown parameter"),
    expected: BadRequestError,
  },
  {
    provider: "anthropic",
    category: "bad_request",
    status: 400,
    body: anthropicError("invalid_request_error", "max_tokens: required"),
    expected: BadRequestError,
  },
  {
    provider: "gemini",
    category: "bad_request",
    status: 400,
    body: geminiError(400, "INVALID_ARGUMENT", "Invalid JSON payload"),
    expected: BadRequestError,
  },
  {
    provider: "openrouter",
    category: "bad_request",
    status: 400,
    body: openrouterError(400, "Invalid request"),
    expected: BadRequestError,
  },
  // context_length
  {
    provider: "openai",
    category: "context_length",
    status: 400,
    body: openaiError("invalid_request_error", "context_length_exceeded"),
    expected: ContextLengthExceededError,
  },
  {
    provider: "anthropic",
    category: "context_length",
    status: 400,
    body: anthropicError(
      "invalid_request_error",
      "prompt is too long: 210000 tokens > 200000 maximum",
    ),
    expected: ContextLengthExceededError,
  },
  {
    provider: "gemini",
    category: "context_length",
    status: 400,
    body: geminiError(
      400,
      "INVALID_ARGUMENT",
      "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).",
    ),
    expected: ContextLengthExceededError,
  },
  {
    provider: "openrouter",
    category: "context_length",
    status: 400,
    body: openrouterError(
      400,
      "This endpoint's maximum context length is 128000 tokens. However, you requested about 200000 tokens.",
    ),
    expected: ContextLengthExceededError,
  },
  // not_found
  {
    provider: "openai",
    category: "not_found",
    status: 404,
    body: openaiError("invalid_request_error", "model_not_found"),
    expected: BadRequestError,
  },
  {
    provider: "anthropic",
    category: "not_found",
    status: 404,
    body: anthropicError("not_found_error"),
    expected: BadRequestError,
  },
  {
    provider: "gemini",
    category: "not_found",
    status: 404,
    body: geminiError(404, "NOT_FOUND"),
    expected: BadRequestError,
  },
  {
    provider: "openrouter",
    category: "not_found",
    status: 404,
    body: openrouterError(404),
    expected: BadRequestError,
  },
  // rate_limit
  {
    provider: "openai",
    category: "rate_limit",
    status: 429,
    body: openaiError("requests", "rate_limit_exceeded"),
    expected: RateLimitError,
  },
  {
    provider: "anthropic",
    category: "rate_limit",
    status: 429,
    body: anthropicError("rate_limit_error"),
    expected: RateLimitError,
  },
  {
    provider: "gemini",
    category: "rate_limit",
    status: 429,
    body: geminiError(429, "RESOURCE_EXHAUSTED"),
    expected: RateLimitError,
  },
  {
    provider: "openrouter",
    category: "rate_limit",
    status: 429,
    body: openrouterError(429),
    expected: RateLimitError,
  },
  // spend_cap — Gemini has no distinct shape in docs/03 (see errorMap.ts)
  {
    provider: "openai",
    category: "spend_cap",
    status: 429,
    body: openaiError("insufficient_quota", "insufficient_quota"),
    expected: QuotaExceededError,
  },
  {
    provider: "anthropic",
    category: "spend_cap",
    status: 429,
    body: anthropicError("rate_limit_error", "x", {
      error_code: "enforced_spend_limit_reached",
    }),
    expected: QuotaExceededError,
  },
  {
    provider: "openrouter",
    category: "spend_cap",
    status: 402,
    body: openrouterError(402, "Insufficient credits"),
    expected: QuotaExceededError,
  },
  // overloaded
  {
    provider: "openai",
    category: "overloaded",
    status: 503,
    body: openaiError("server_error", null),
    expected: UpstreamServerError,
  },
  {
    provider: "anthropic",
    category: "overloaded",
    status: 529,
    body: anthropicError("overloaded_error", "Overloaded"),
    expected: UpstreamServerError,
  },
  {
    provider: "gemini",
    category: "overloaded",
    status: 503,
    body: geminiError(503, "UNAVAILABLE"),
    expected: UpstreamServerError,
  },
  {
    provider: "openrouter",
    category: "overloaded",
    status: 502,
    body: openrouterError(502),
    expected: UpstreamServerError,
  },
  // server
  {
    provider: "openai",
    category: "server",
    status: 500,
    body: openaiError("server_error", null),
    expected: UpstreamServerError,
  },
  {
    provider: "anthropic",
    category: "server",
    status: 500,
    body: anthropicError("api_error"),
    expected: UpstreamServerError,
  },
  {
    provider: "gemini",
    category: "server",
    status: 500,
    body: geminiError(500, "INTERNAL"),
    expected: UpstreamServerError,
  },
  {
    provider: "openrouter",
    category: "server",
    status: 500,
    body: openrouterError(500),
    expected: UpstreamServerError,
  },
  // content_filter — HTTP 200, from the stop reason
  {
    provider: "openai",
    category: "content_filter",
    status: 200,
    body: {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "I can't help with that." }],
        },
      ],
    },
    expected: ContentFilterError,
  },
  {
    provider: "anthropic",
    category: "content_filter",
    status: 200,
    body: { type: "message", content: [], stop_reason: "refusal" },
    expected: ContentFilterError,
  },
  {
    provider: "gemini",
    category: "content_filter",
    status: 200,
    body: { candidates: [{ finishReason: "SAFETY" }] },
    expected: ContentFilterError,
  },
  {
    provider: "openrouter",
    category: "content_filter",
    status: 200,
    body: { choices: [{ finish_reason: "content_filter" }] },
    expected: ContentFilterError,
  },
];

describe("mapProviderError — docs/03 §11.5 onto docs/07 §10.1", () => {
  it.each(CASES)(
    "maps $provider $category (HTTP $status) onto $expected.name",
    ({ provider, status, body, expected }) => {
      const error = map(provider, status, body);
      expect(error).toBeInstanceOf(expected);
      // Exactly that class, not a subclass of it standing in.
      expect(error?.constructor).toBe(expected);
    },
  );

  it("covers every category for every provider it has a shape for", () => {
    const categories = [
      "auth",
      "bad_request",
      "context_length",
      "not_found",
      "rate_limit",
      "overloaded",
      "server",
      "content_filter",
    ];
    const providers: readonly ProviderId[] = [
      "openai",
      "anthropic",
      "gemini",
      "openrouter",
    ];
    for (const provider of providers) {
      for (const category of categories) {
        expect(
          CASES.some((c) => c.provider === provider && c.category === category),
          `${provider} ${category}`,
        ).toBe(true);
      }
    }
    // spend_cap: three providers; Gemini's RESOURCE_EXHAUSTED is the rate row.
    expect(
      CASES.filter((c) => c.category === "spend_cap").map((c) => c.provider),
    ).toEqual(["openai", "anthropic", "openrouter"]);
  });

  it("returns nothing for an ordinary HTTP-200 answer from any provider", () => {
    expect(
      map("openai", 200, {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: "ok" }] },
        ],
        incomplete_details: null,
      }),
    ).toBeUndefined();
    expect(
      map("openai", 200, {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    ).toBeUndefined();
    expect(
      map("anthropic", 200, { content: [], stop_reason: "end_turn" }),
    ).toBeUndefined();
    expect(
      map("anthropic", 200, { content: [], stop_reason: "max_tokens" }),
    ).toBeUndefined();
    expect(
      map("gemini", 200, { candidates: [{ finishReason: "STOP" }] }),
    ).toBeUndefined();
    expect(
      map("openrouter", 200, { choices: [{ finish_reason: "stop" }] }),
    ).toBeUndefined();
    expect(map("openrouter", 200, "")).toBeUndefined();
  });

  it("reads the other refusal shapes: Responses incomplete, Chat Completions, Gemini blockReason", () => {
    expect(
      map("openai", 200, {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      }),
    ).toBeInstanceOf(ContentFilterError);
    expect(
      map("openai", 200, { choices: [{ finish_reason: "content_filter" }] }),
    ).toBeInstanceOf(ContentFilterError);
    expect(
      map("gemini", 200, { promptFeedback: { blockReason: "SAFETY" } }),
    ).toBeInstanceOf(ContentFilterError);
    expect(
      map("gemini", 200, {
        candidates: [{ finishReason: "PROHIBITED_CONTENT" }],
      }),
    ).toBeInstanceOf(ContentFilterError);
  });

  it("detects a refusal from the body, never from the status code", () => {
    // Anthropic's refusal shape on another provider is not that provider's
    // refusal, and a 4xx carrying a refusal-shaped body is still a 4xx.
    expect(map("openai", 200, { stop_reason: "refusal" })).toBeUndefined();
    expect(map("anthropic", 400, { stop_reason: "refusal" })).toBeInstanceOf(
      BadRequestError,
    );
  });

  it("maps Anthropic's 529 to a retryable UpstreamServerError marked as overload", () => {
    const error = map(
      "anthropic",
      529,
      anthropicError("overloaded_error", "Overloaded"),
    );
    expect(error).toBeInstanceOf(UpstreamServerError);
    expect(error?.retryable).toBe(true);
    expect(isRetriedAutomatically(error)).toBe(true);
    expect(error?.context.httpStatus).toBe(529);
    expect(error?.context.overloaded).toBe(true);
    // A plain 5xx is not marked: the 529 branch is the one that fired.
    expect(
      map("anthropic", 500, anthropicError("api_error"))?.context,
    ).not.toHaveProperty("overloaded");
  });

  it("maps Anthropic's spend-cap 429 to QuotaExceededError, which is not retried", async () => {
    const error = map(
      "anthropic",
      429,
      anthropicError("rate_limit_error", "spend cap", {
        error_code: "enforced_spend_limit_reached",
      }),
    );
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error?.messageKey).toBe("rh-error-quota");
    expect(error?.retryable).toBe(false);
    expect(isRetriedAutomatically(error)).toBe(false);

    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts += 1;
          return Promise.reject(error);
        },
        {
          policy: retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0),
          clock: createManualClock(),
        },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it("does not take an Anthropic 429 without the spend-cap code for a spend cap", () => {
    expect(
      map(
        "anthropic",
        429,
        anthropicError("rate_limit_error", "x", {
          error_code: "something_else",
        }),
      ),
    ).toBeInstanceOf(RateLimitError);
    // OpenRouter's 402 is a spend cap; a 402 elsewhere is a plain 4xx.
    expect(map("openai", 402, openaiError("x", null))).toBeInstanceOf(
      BadRequestError,
    );
  });

  it("maps an HTTP-200 Anthropic refusal to ContentFilterError and does not retry it", async () => {
    const error = map("anthropic", 200, {
      type: "message",
      content: [],
      stop_reason: "refusal",
    });
    expect(error).toBeInstanceOf(ContentFilterError);
    expect(error?.retryable).toBe(false);
    expect(error?.messageKey).toBe("rh-error-content-filter");

    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts += 1;
          return Promise.reject(error);
        },
        {
          policy: retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 0),
          clock: createManualClock(),
        },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it("delays the next attempt by a 429's Retry-After: 30, through the existing withRetry", async () => {
    const clock = createManualClock(NOW);
    const startedAt: number[] = [];
    const promise = withRetry(
      (attempt) => {
        startedAt.push(clock.now());
        if (attempt === 1) {
          return Promise.reject(
            mapProviderError(
              "anthropic",
              MODEL,
              429,
              headers({ "Retry-After": "30" }),
              JSON.stringify(anthropicError("rate_limit_error")),
              clock.now(),
            ),
          );
        }
        return Promise.resolve("answer");
      },
      {
        policy: retryPolicyFromBudget(LLM_RETRY_BUDGET, () => 1),
        clock,
      },
    );

    // Let the first attempt fail and the wait be scheduled.
    await Promise.resolve();
    await Promise.resolve();
    expect(clock.pending).toBe(1);
    clock.advance(29_999);
    await Promise.resolve();
    expect(startedAt).toHaveLength(1);
    clock.advance(1);
    await expect(promise).resolves.toBe("answer");
    expect(startedAt).toEqual([NOW, NOW + 30_000]);
  });

  it("reads Retry-After into RateLimitError.retryAfterMs, both forms, and leaves it absent otherwise", () => {
    const seconds = map("openai", 429, openaiError("requests", "x"), {
      "retry-after": "12",
    });
    expect((seconds as RateLimitError).retryAfterMs).toBe(12_000);

    const date = new Date(NOW + 45_000).toUTCString();
    const dated = map("openai", 429, openaiError("requests", "x"), {
      "retry-after": date,
    });
    expect((dated as RateLimitError).retryAfterMs).toBe(45_000);

    const none = map("openai", 429, openaiError("requests", "x"));
    expect((none as RateLimitError).retryAfterMs).toBeUndefined();

    // A 503's Retry-After rides in the context, where withRetry reads it.
    const busy = map("gemini", 503, geminiError(503, "UNAVAILABLE"), {
      "retry-after": "7",
    });
    expect(busy?.context.retryAfterMs).toBe(7_000);
  });

  it("does not retry a 401, a 403 or a context-length error automatically", () => {
    for (const error of [
      map("openai", 401, openaiError("x", "invalid_api_key")),
      map("gemini", 403, geminiError(403, "PERMISSION_DENIED")),
      map("openai", 400, openaiError("x", "context_length_exceeded")),
    ]) {
      expect(isRetriedAutomatically(error)).toBe(false);
    }
  });

  it("never produces a StructuredOutputError: its retry is the repair prompt, not the transport", () => {
    for (const { provider, status, body } of CASES) {
      expect(map(provider, status, body)).not.toBeInstanceOf(
        StructuredOutputError,
      );
    }
  });

  it("carries the provider and model, and keeps the provider's message text out", () => {
    const echoed =
      "prompt is too long: summarize PATIENT-CONFIDENTIAL text with sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const error = map(
      "anthropic",
      400,
      anthropicError("invalid_request_error", echoed),
    );
    expect(error).toBeInstanceOf(ContextLengthExceededError);
    expect(error?.context.providerId).toBe("anthropic");
    expect(error?.context.modelId).toBe(MODEL);
    expect(error?.context.providerErrorType).toBe("invalid_request_error");
    const everything = `${error?.message} ${JSON.stringify(error?.context)}`;
    expect(everything).not.toContain("PATIENT-CONFIDENTIAL");
    expect(everything).not.toContain("sk-ant-api03");
  });

  it("keeps the provider's message text out of every class it builds", () => {
    // Every failure status the table maps, with the provider's message
    // replaced by an echo of the request. The context-length case above
    // builds its context on its own path; this covers the shared one.
    const echo = "ECHOED-PROMPT-TEXT";
    const withEcho = (body: unknown): unknown =>
      JSON.parse(
        JSON.stringify(body).replace(
          /"message":"[^"]*"/g,
          () => `"message":"${echo}"`,
        ),
      );
    const failures = CASES.filter((c) => c.status >= 400);
    expect(failures.length).toBeGreaterThan(20);
    for (const { provider, status, body } of failures) {
      const error = map(provider, status, withEcho(body));
      const everything = `${error?.message} ${JSON.stringify(error?.context)}`;
      expect(everything, `${provider} HTTP ${status}`).not.toContain(echo);
    }
  });

  it("redacts a key-shaped value in a machine field before it reaches the error", () => {
    const key = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";
    const error = map("openai", 400, openaiError("invalid_request_error", key));
    expect(error).toBeInstanceOf(BadRequestError);
    const everything = `${error?.message} ${JSON.stringify(error?.context)}`;
    expect(everything).not.toContain(key);
  });

  it("maps a body that is not JSON by its status alone", () => {
    expect(map("openrouter", 502, "<html>Bad gateway</html>")).toBeInstanceOf(
      UpstreamServerError,
    );
    expect(map("openai", 401, "")).toBeInstanceOf(AuthenticationError);
    expect(map("anthropic", 400, "not json")).toBeInstanceOf(BadRequestError);
  });
});

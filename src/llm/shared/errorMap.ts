/**
 * One mapping from a provider's failure to one shipped error class.
 *
 * **Scope.** `P3-T05`. Callers: the four adapters, `P3-T07`–`P3-T10`, each of
 * which hands this function what it got back from the provider. Nothing here
 * sends a request, retries or waits: the retry loop is `withRetry` in
 * `src/core/http/retry.ts` and the wait shape is `decorrelatedJitter` in
 * `src/core/rateLimit/backoff.ts`, and neither is restated here.
 *
 * **Authority.** `docs/03` §11.5's taxonomy, mapped onto `docs/07` §10.1's
 * classes by `docs/03` §14.1's authority note. Every class below is the one
 * already shipped in `src/core/errors.ts`; this file declares none.
 *
 * | §11.5 category | Class returned |
 * |---|---|
 * | `auth` | `AuthenticationError` (401, and Gemini's 400 `API_KEY_INVALID`), `AuthorizationError` (403) |
 * | `bad_request`, `not_found` | `BadRequestError` |
 * | `context_length` | `ContextLengthExceededError` |
 * | `rate_limit` | `RateLimitError`, with `retryAfterMs` from `parseRetryAfter` |
 * | `spend_cap` | `QuotaExceededError` (`rh-error-quota`, not retryable) |
 * | `overloaded`, `server` | `UpstreamServerError` — **529 included** |
 * | `content_filter` | `ContentFilterError`, from the stop reason on HTTP 200 |
 * | anything else | `LLMError` itself |
 *
 * ## The three traps `docs/03` §11.5 names
 *
 * 1. **Anthropic overload is HTTP 529.** It is matched by number before the
 *    generic 5xx branch, so the rule does not rest on `status >= 500`
 *    happening to cover it.
 * 2. **Refusals and content filtering arrive with HTTP 200.** They are read
 *    from `stop_reason` / `finish_reason` / `finishReason` in the body, never
 *    from a status code, and the class they map to is not retryable.
 * 3. **A spend cap looks like a rate limit.** Anthropic's is a 429 whose body
 *    carries `error.details.error_code: "enforced_spend_limit_reached"`
 *    (`docs/03` §11.1); OpenAI's is a 429 with `insufficient_quota`;
 *    OpenRouter's is a 402. Each is checked **before** the 429 branch.
 *
 * ## What the shipped HTTP client does first — read before calling this
 *
 * `src/core/http/client.ts`'s `classify` turns every status of 400 and above
 * into a `docs/07` §10.1 class **inside** the retry loop — unless the request
 * carries `mapErrorResponse` (`HttpOptions`, `P3-T38`, `plan/00` §6 item 244;
 * `docs/07` §7.3's dated note "An LLM host's error answer is read before the
 * retry decision"). Each adapter passes, with every request, a hook that
 * calls this function:
 *
 * ```ts
 * mapErrorResponse: (response, nowEpochMs) =>
 *   mapProviderError(providerId, modelId, response.status,
 *     (name) => response.header(name), response.body, nowEpochMs),
 * ```
 *
 * The client asks the hook inside the attempt, after `penalize` and before it
 * picks a class, and throws what it returns; so a spend cap comes back as
 * `QuotaExceededError` and the loop stops after one attempt, while an ordinary
 * 429 is a `RateLimitError` the loop still retries. The `body` the hook sees
 * has already been through `redactText`; a body the redactor left unparseable
 * as JSON is mapped by its status alone. A 2xx is never handed to the hook:
 * the adapter calls this function on the returned response itself, outside
 * the loop, for the refusal row. Correct for any other caller that can hand
 * it the status, the headers and the body.
 *
 * ## Nothing from the body reaches the error unredacted
 *
 * A provider's error message can echo the request — the prompt, a quoted
 * passage, sometimes a key fragment — and `docs/07` §10.2 forbids showing a
 * raw provider message to the user. So the error carries only the provider's
 * short machine fields (`type`, `code`, `status`, the stop reason), each put
 * through `redact` from `src/core/errors.ts`, and never the message text.
 * `ResearchHelperError.context` must already be redacted by the thrower.
 */

import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ContentFilterError,
  ContextLengthExceededError,
  LLMError,
  QuotaExceededError,
  RateLimitError,
  redact,
  type ResearchHelperError,
  UpstreamError,
  UpstreamServerError,
} from "../../core/errors";
import { parseRetryAfter } from "../../core/rateLimit/backoff";
import type { ProviderId } from "../../model/ids";

/** A response-header lookup, case-insensitive, as `HttpResponse.header` is. */
export type ProviderHeaderLookup = (name: string) => string | undefined;

/** Anthropic's overload status: non-standard, and not a 503 (`docs/03` §11.5). */
export const ANTHROPIC_OVERLOADED_STATUS = 529;

/** Anthropic's spend-cap marker, `error.details.error_code` (`docs/03` §11.1). */
export const ANTHROPIC_SPEND_CAP_CODE = "enforced_spend_limit_reached";

/** OpenRouter's spend cap: HTTP 402, insufficient credits (`docs/03` §11.5). */
export const OPENROUTER_SPEND_CAP_STATUS = 402;

/** OpenAI's spend cap: a 429 whose `error.code` or `error.type` is this. */
export const OPENAI_SPEND_CAP_CODE = "insufficient_quota";

/**
 * Whether a key Test's failure still means **the key was accepted**
 * (`docs/09` §2.3; owner, 2026-10-23, `plan/00` §6 item 279(a)): any HTTP 429
 * — a rate limit or a spend cap — and any `QuotaExceededError`, whatever its
 * status, so OpenRouter's 402 too. The four adapters' `validateCredentials`
 * share it; the pane tells the out-of-credit case apart by its `messageKey`
 * (`rh-error-quota`).
 *
 * @param error - what the Test's request threw
 * @returns `true` when the answer says the key itself is good
 */
export function isKeyAcceptedFailure(error: ResearchHelperError): boolean {
  if (error instanceof QuotaExceededError) return true;
  return error instanceof UpstreamError && error.httpStatus === 429;
}

/**
 * Gemini's legacy `finishReason` values that mean the provider's safety system
 * stopped the answer (`docs/03` §11.5: "`finishReason: SAFETY` / blocked").
 */
const GEMINI_BLOCKED_FINISH_REASONS: ReadonlySet<string> = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
]);

/** The short machine fields of a provider's error body, already redacted. */
interface ProviderErrorFields {
  /** Anthropic and OpenAI `error.type`. */
  readonly type?: string;
  /** OpenAI `error.code`, or OpenRouter's numeric `error.code` as text. */
  readonly code?: string;
  /** Gemini's gRPC-style `error.status`, e.g. `INVALID_ARGUMENT`. */
  readonly status?: string;
  /** Anthropic `error.details.error_code`. */
  readonly detailCode?: string;
  /** Gemini `error.details[].reason`, e.g. `API_KEY_INVALID`. */
  readonly reasons: readonly string[];
  /**
   * The provider's message, used **only** to recognise a context-length
   * failure and never copied into an error.
   */
  readonly message: string;
}

/** The parsed body, or `undefined` when it is not a JSON object. */
function parseBody(body: string): Record<string, unknown> | undefined {
  if (body.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = record?.[name];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function recordField(
  record: Record<string, unknown> | undefined,
  name: string,
): Record<string, unknown> | undefined {
  const value = record?.[name];
  return isRecord(value) ? value : undefined;
}

function arrayField(
  record: Record<string, unknown> | undefined,
  name: string,
): readonly unknown[] {
  const value = record?.[name];
  return Array.isArray(value) ? value : [];
}

/** Read `{ error: { … } }`, the envelope all four providers use. */
function errorFields(
  parsed: Record<string, unknown> | undefined,
): ProviderErrorFields {
  const error = recordField(parsed, "error");
  const details = recordField(error, "details");
  const reasons = arrayField(error, "details")
    .filter(isRecord)
    .map((detail) => stringField(detail, "reason"))
    .filter((reason): reason is string => reason !== undefined);
  const type = stringField(error, "type");
  const code = stringField(error, "code");
  const status = stringField(error, "status");
  const detailCode = stringField(details, "error_code");
  return {
    ...(type !== undefined && { type }),
    ...(code !== undefined && { code }),
    ...(status !== undefined && { status }),
    ...(detailCode !== undefined && { detailCode }),
    reasons,
    message: stringField(error, "message") ?? "",
  };
}

/** The redacted machine fields an error carries in its context. */
function contextOf(
  fields: ProviderErrorFields,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (fields.type !== undefined) out.providerErrorType = redact(fields.type);
  if (fields.code !== undefined) out.providerErrorCode = redact(fields.code);
  if (fields.status !== undefined)
    out.providerErrorStatus = redact(fields.status);
  if (fields.detailCode !== undefined)
    out.providerErrorDetail = redact(fields.detailCode);
  return out;
}

/** The one field that names what went wrong, for the developer message. */
function summaryOf(fields: ProviderErrorFields): string {
  return redact(
    fields.detailCode ??
      fields.code ??
      fields.type ??
      fields.status ??
      "no error body",
  );
}

/**
 * `docs/03` §11.5's spend-cap row. Checked before the 429 branch, because two
 * of the three providers that have one send it as a 429.
 */
function isSpendCap(
  providerId: ProviderId,
  status: number,
  fields: ProviderErrorFields,
): boolean {
  switch (providerId) {
    case "anthropic":
      return status === 429 && fields.detailCode === ANTHROPIC_SPEND_CAP_CODE;
    case "openai":
      return (
        status === 429 &&
        (fields.code === OPENAI_SPEND_CAP_CODE ||
          fields.type === OPENAI_SPEND_CAP_CODE)
      );
    case "openrouter":
      return status === OPENROUTER_SPEND_CAP_STATUS;
    case "gemini":
      // `docs/03` §11.3 and §11.5 give Gemini no spend-cap shape distinct from
      // `RESOURCE_EXHAUSTED`, which is the rate-limit row. Its 10-minute
      // spend window recovers on its own, so a 429 there is a rate limit.
      return false;
  }
}

/** `docs/03` §11.5's context-length row, per provider. */
function isContextLength(
  providerId: ProviderId,
  status: number,
  fields: ProviderErrorFields,
): boolean {
  if (status !== 400) return false;
  switch (providerId) {
    case "openai":
      return fields.code === "context_length_exceeded";
    case "anthropic":
      return (
        fields.type === "invalid_request_error" &&
        /prompt is too long/i.test(fields.message)
      );
    case "gemini":
      return (
        fields.status === "INVALID_ARGUMENT" &&
        /token count|maximum number of tokens/i.test(fields.message)
      );
    case "openrouter":
      return /context length/i.test(fields.message);
  }
}

/** Gemini answers a bad key with HTTP 400 and `reason: API_KEY_INVALID`. */
function isGeminiBadKey(
  providerId: ProviderId,
  fields: ProviderErrorFields,
): boolean {
  return providerId === "gemini" && fields.reasons.includes("API_KEY_INVALID");
}

/**
 * The stop reason of an HTTP-200 body that means the model or the provider's
 * safety system declined, or `undefined` when the answer was not declined.
 *
 * Per `docs/03` §11.5 trap 2 and §14.3, read from the body only:
 *
 * - Anthropic: `stop_reason: "refusal"` (§2's notes: "Always check
 *   `stop_reason` before reading `content`").
 * - OpenAI Responses API: `incomplete_details.reason: "content_filter"`, or a
 *   `refusal` content part inside an output `message`.
 * - OpenAI Chat Completions and OpenRouter: `choices[].finish_reason:
 *   "content_filter"` (OpenRouter normalizes every upstream onto it).
 * - Gemini, legacy `generateContent` shape: `candidates[].finishReason` in
 *   {@link GEMINI_BLOCKED_FINISH_REASONS}, or `promptFeedback.blockReason`.
 *   The Interactions API's blocked shape is not recorded in `docs/03` and is
 *   not guessed at here (`P3-T05` report).
 */
function declinedReason(
  providerId: ProviderId,
  parsed: Record<string, unknown> | undefined,
): string | undefined {
  if (parsed === undefined) return undefined;
  switch (providerId) {
    case "anthropic":
      return stringField(parsed, "stop_reason") === "refusal"
        ? "refusal"
        : undefined;
    case "openai": {
      const incomplete = recordField(parsed, "incomplete_details");
      if (stringField(incomplete, "reason") === "content_filter") {
        return "content_filter";
      }
      const refused = arrayField(parsed, "output")
        .filter(isRecord)
        .flatMap((item) => arrayField(item, "content"))
        .filter(isRecord)
        .some((part) => stringField(part, "type") === "refusal");
      if (refused) return "refusal";
      return choicesFiltered(parsed) ? "content_filter" : undefined;
    }
    case "openrouter":
      return choicesFiltered(parsed) ? "content_filter" : undefined;
    case "gemini": {
      const blockReason = stringField(
        recordField(parsed, "promptFeedback"),
        "blockReason",
      );
      if (blockReason !== undefined) return blockReason;
      return arrayField(parsed, "candidates")
        .filter(isRecord)
        .map((candidate) => stringField(candidate, "finishReason"))
        .find(
          (reason): reason is string =>
            reason !== undefined && GEMINI_BLOCKED_FINISH_REASONS.has(reason),
        );
    }
  }
}

/** Chat Completions' `choices[].finish_reason: "content_filter"`. */
function choicesFiltered(parsed: Record<string, unknown>): boolean {
  return arrayField(parsed, "choices")
    .filter(isRecord)
    .some(
      (choice) => stringField(choice, "finish_reason") === "content_filter",
    );
}

/**
 * Map one provider response onto the shipped error class it means.
 *
 * Returns `undefined` for a 2xx whose body is an ordinary answer — that is a
 * result, not a failure. A 2xx whose body says the model or the provider's
 * safety system declined is a {@link ContentFilterError}; every other status
 * maps to exactly one class, per the table in this module's header.
 *
 * **One deviation from the card, reported.** `P3-T05` step 1 writes
 * `mapProviderError(providerId, modelId, status, headers, body)`. The sixth
 * parameter, `nowEpochMs`, is the caller's `clock.now()`: `parseRetryAfter`
 * needs it to turn an HTTP-date `Retry-After` into a delay, and reading
 * `Date.now()` here would bypass the injected clock (`src/core/clock.ts`).
 *
 * @param providerId - which adapter is asking
 * @param modelId - the model the request named
 * @param status - the HTTP status
 * @param headers - the response's case-insensitive header lookup
 * @param body - the response body as text; `""` when there was none
 * @param nowEpochMs - the caller's `clock.now()`, for `Retry-After`
 * @returns the error, or `undefined` for an answer that is not a failure
 */
export function mapProviderError(
  providerId: ProviderId,
  modelId: string,
  status: number,
  headers: ProviderHeaderLookup,
  body: string,
  nowEpochMs: number,
): ResearchHelperError | undefined {
  const parsed = parseBody(body);

  if (status >= 200 && status < 300) {
    const declined = declinedReason(providerId, parsed);
    if (declined === undefined) return undefined;
    return new ContentFilterError(
      providerId,
      modelId,
      `${providerId} declined the request: ${redact(declined)}`,
      { stopReason: redact(declined) },
    );
  }

  const fields = errorFields(parsed);
  const context = { ...contextOf(fields), providerId, modelId };
  const where = `HTTP ${status} from ${providerId}: ${summaryOf(fields)}`;

  if (isSpendCap(providerId, status, fields)) {
    return new QuotaExceededError(status, where, context);
  }
  if (status === 429) {
    return new RateLimitError(
      status,
      parseRetryAfter(headers("retry-after"), nowEpochMs),
      providerId,
    );
  }
  if (status === 401 || isGeminiBadKey(providerId, fields)) {
    return new AuthenticationError(status, where, context);
  }
  if (status === 403) {
    return new AuthorizationError(status, where, context);
  }
  if (isContextLength(providerId, status, fields)) {
    return new ContextLengthExceededError(providerId, modelId, where, {
      ...contextOf(fields),
      httpStatus: status,
    });
  }
  if (status === ANTHROPIC_OVERLOADED_STATUS) {
    // Its own branch, ahead of the generic 5xx one, so that overload is
    // recognised by its number and marked as such (`docs/03` §11.5 trap 1).
    return new UpstreamServerError(status, where, {
      ...context,
      overloaded: true,
    });
  }
  if (status >= 500) {
    const retryAfterMs =
      status === 503
        ? parseRetryAfter(headers("retry-after"), nowEpochMs)
        : undefined;
    return new UpstreamServerError(status, where, {
      ...context,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }
  if (status >= 400) {
    return new BadRequestError(status, where, context);
  }
  return new LLMError(providerId, modelId, where, {
    ...contextOf(fields),
    httpStatus: status,
  });
}

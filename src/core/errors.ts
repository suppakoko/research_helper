/**
 * The typed error hierarchy, and the redaction primitives every part of it and
 * the logger share.
 *
 * **Scope.** `P1-T02`. `docs/07` §10.1 is transcribed **in full** — including
 * the `LLMError` subtree Phase 3 throws and the `TTSError` Phase 5 throws —
 * because the card's **Notes** require it: "the full `docs/07` §10.1 hierarchy
 * is transcribed now rather than grown incrementally, because Phase 3's
 * `LLMError` subtree is already in it and a partial copy diverges."
 *
 * **Authority.** Class names, `code` strings, `messageKey` strings, `retryable`
 * and `userFacing` values and constructor signatures are
 * `docs/07-architecture-and-data-model.md` §10.1's, verbatim.
 * {@link SerializedError} is §5.2's, verbatim. {@link KEYISH_FIELD},
 * {@link KEY_PATTERNS} and {@link redact} are
 * `docs/09-security-privacy-and-api-keys.md` §2.1's, verbatim.
 *
 * ## Why the redaction primitives live in this file
 *
 * `docs/09` §2.1 prints `KEYISH_FIELD`, `KEY_PATTERNS` and `redact()` in a code
 * block with **no file header**, and `docs/07` §10.3 says only that they "must
 * not be duplicated with drift; `src/core/logger.ts` imports them from one
 * place". This is that place, for three reasons:
 *
 * 1. §10.1's own code — `toSerialized()`'s `detail: redact(this.message)` and
 *    `TimeoutError`'s `{ url: redactUrl(url) }` — calls both functions from
 *    inside `src/core/errors.ts`, so this file needs them regardless.
 * 2. `P1-T02` step 4 is the `errors.ts` step and it is the step that says
 *    "implement `redact()` and `redactUrl()`".
 * 3. `src/prefs/secrets.ts`, where §2.1's sibling `Secret` block does carry a
 *    file header, is not reachable: `docs/07` §2.3 lets `core/` import `model/`
 *    only, and `eslint.config.js` enforces it.
 *
 * `src/core/logger.ts` imports them from here. `P1-T02`'s `Files` list creates
 * no third module, so a `redaction.ts` would be scope this card does not have
 * (`plan/README.md` §5 rule 2).
 *
 * ## `userFacing` and NFR-14
 *
 * Every class carries a Fluent `messageKey` and never an English sentence for
 * the user: `docs/10` NFR-14 forbids a bare "An error occurred", and a raw
 * string here would be unlocalizable in the UI (FR-55 / NFR-11). The `message`
 * passed to the constructor is the *developer*-facing half — it reaches
 * `Zotero.debug` through `toSerialized().detail`, already redacted, and never a
 * dialog. §10.2 owns which audience sees which.
 */

import type { CancellationReason } from "./jobQueue/cancellation";

// ---------------------------------------------------------------------------
// 1. Redaction — docs/09 §2.1, verbatim
// ---------------------------------------------------------------------------

/**
 * Field names whose *value* is a credential whatever it looks like.
 *
 * Note the substring spellings: `authoriz` catches both `Authorization` and
 * `authorization`, and `api[-_]?key` catches `x-api-key`, `apiKey` and
 * `api_key`. `docs/07` §10.3 requires the `Authorization` and `x-api-key`
 * headers never to be logged at any level; this pattern is how that is true
 * mechanically rather than by call-site discipline.
 */
export const KEYISH_FIELD =
  /api[-_]?key|token|secret|authoriz|password|bearer|credential/i;

/**
 * Known credential shapes, matched inside free text.
 *
 * `docs/09` §2.1 on the last entry: "The final catch-all pattern will
 * occasionally redact a legitimate long token (a base64 chunk, a hash). That is
 * the correct trade: a false-positive redaction costs a debugging
 * inconvenience; a false negative publishes a billing credential to a GitHub
 * issue."
 *
 * The patterns carry `/g`, so they are stateful (`lastIndex`). {@link redact}
 * uses `String.replace`, which resets `lastIndex` for a global pattern, so
 * reuse across calls is safe — but nothing else may call `.test()` on these.
 */
export const KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic
  /\bsk-or-v1-[A-Za-z0-9]{32,}/g, // OpenRouter
  /\bsk-proj-[A-Za-z0-9_-]{20,}/g, // OpenAI project keys
  /\bsk-[A-Za-z0-9]{32,}/g, // OpenAI legacy
  /\bAIza[A-Za-z0-9_-]{35}/g, // Google API keys
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi, // any bearer token
  /\b[A-Za-z0-9_-]{40,}\b/g, // long opaque run — last-resort net
];

/**
 * Replace every credential-shaped run in `input` with `[redacted:<len>]`.
 *
 * `docs/09` §2.1's reference implementation, unchanged.
 *
 * @param input - arbitrary text that may contain a key
 * @returns the text with every {@link KEY_PATTERNS} match replaced
 */
export function redact(input: string): string {
  let out = input;
  for (const re of KEY_PATTERNS)
    out = out.replace(re, (m) => `[redacted:${m.length}]`);
  return out;
}

/**
 * Query parameters `docs/07` §10.3 and `docs/09` §2.1 require to be stripped
 * from any logged or stored URL. Compared case-insensitively.
 */
const SECRET_QUERY_PARAMS: readonly string[] = [
  "key",
  "api_key",
  "apikey",
  "token",
  "access_token",
];

/**
 * Strip credential-bearing query parameters from a URL, then {@link redact}
 * what is left.
 *
 * This is the **backstop**, not the rule. `docs/09` §2.1: "the primary rule is
 * to never put a credential in a URL" — Gemini's `key` parameter is why the
 * plugin always sends `x-goog-api-key` as a header instead. But a URL reaches
 * the log and the `SourceProvenance.transmittedUrl` field (`docs/07` §5.3) from
 * several directions, and NFR-16 hangs on none of them leaking.
 *
 * The parameter is **removed**, not blanked: a `?api_key=` with an empty value
 * still tells a reader the request carried a key, and an empty value is the one
 * thing `[redacted:<len>]` cannot express.
 *
 * An unparseable input is not passed through — a string that is not a URL may
 * still be anything, so it goes through {@link redact} like any other text.
 *
 * @param url - a URL, absolute or not
 * @returns the URL without secret parameters, with key-shaped runs redacted
 */
export function redactUrl(url: string): string {
  try {
    // `URL` is in the sandbox's measured global set (docs/01 §2.3). The base
    // makes a relative URL parse; it is stripped again below.
    const base = "http://rh.invalid/";
    const parsed = new URL(url, base);
    let removed = false;
    for (const name of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_PARAMS.includes(name.toLowerCase())) {
        parsed.searchParams.delete(name);
        removed = true;
      }
    }
    if (!removed) return redact(url);
    const rebuilt = parsed.toString();
    return redact(
      rebuilt.startsWith(base) ? rebuilt.slice(base.length - 1) : rebuilt,
    );
  } catch {
    return redact(url);
  }
}

// ---------------------------------------------------------------------------
// 2. `SerializedError` — docs/07 §5.2, verbatim
// ---------------------------------------------------------------------------

/**
 * The wire form of a thrown error.
 *
 * Stored in `JobRecord.error` (§5.2) and in `SourceProvenance.error` (§5.3,
 * which `P1-T17` writes and `schema/provenance.schema.json` validates), so its
 * field names are part of an exported artefact and not an internal detail.
 */
export interface SerializedError {
  readonly code: string;
  readonly messageKey: string;
  /** Developer-facing message; already redacted. */
  readonly detail: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly stack?: string;
}

// ---------------------------------------------------------------------------
// 3. The hierarchy — docs/07 §10.1
//
// One deviation from §10.1's text, and it is forced: every concrete `code`,
// `messageKey` and `retryable` below carries an explicit `: string` / `: boolean`
// annotation that §10.1 does not write.
//
// **§10.1 as printed does not compile.** `class NetworkError { readonly code =
// "NETWORK" }` gives the property the *literal* type `"NETWORK"`, so
// `OfflineError`'s `override readonly code = "OFFLINE"` is TS2416: "Type
// '\"OFFLINE\"' is not assignable to type '\"NETWORK\"'". Measured on
// TypeScript 5.9.3 with this repository's `tsconfig.json`: fifteen errors across
// the five subclass-of-a-concrete-class pairs §10.1 declares —
// MissingCredentialError, OfflineError, TimeoutError, ParseError, and all three
// arms of the LLMError subtree. It is not a strict-flag artefact; it is ordinary
// subtype checking, and the same code fails under plain `strict`.
//
// The annotation is the minimal repair: it restores the base class's declared
// property type, so an override is assignable, and it changes no runtime value —
// every `code` string is still §10.1's, which is what the card's third
// acceptance criterion asserts. The alternative repairs are worse: widening the
// base to `code: string` is already the case, and re-declaring each subclass's
// value in the parent's union would put every future code in every ancestor.
// ---------------------------------------------------------------------------

/** Base for everything the plugin throws deliberately. */
export abstract class ResearchHelperError extends Error {
  /** Stable machine code, e.g. "SOURCE_RATE_LIMIT". Used in logs and telemetry-free analytics. */
  abstract readonly code: string;
  /** Fluent message ID for the user-facing string. Never a raw English sentence. */
  abstract readonly messageKey: string;
  /** Whether a retry could plausibly succeed without user intervention. */
  abstract readonly retryable: boolean;
  /** True when this should be shown to the user; false = log only. */
  readonly userFacing: boolean = true;
  /** Structured context. MUST already be redacted by the thrower. */
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    context: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    this.context = Object.freeze({ ...context });
  }

  /**
   * The redacted, storable form of this error.
   *
   * `httpStatus` and `stack` are spread in conditionally rather than assigned
   * `| undefined`. §10.1's transcription writes them as plain properties, which
   * does not compile against {@link SerializedError}'s optional members under
   * `tsconfig.json`'s `exactOptionalPropertyTypes: true` (`docs/13` §1.5's
   * strict family). Present-or-absent is also the shape the provenance JSON
   * schema wants: an explicit `"stack": null` in an exported artefact is a field
   * a consumer has to special-case.
   */
  toSerialized(): SerializedError {
    const { httpStatus } = this as unknown as { httpStatus?: number };
    const { stack } = this;
    return {
      code: this.code,
      messageKey: this.messageKey,
      detail: redact(this.message),
      retryable: this.retryable,
      ...(httpStatus !== undefined && { httpStatus }),
      ...(stack !== undefined && { stack }),
    };
  }
}

/* ---- Configuration ---- */
export class ConfigurationError extends ResearchHelperError {
  readonly code: string = "CONFIGURATION";
  readonly messageKey: string = "rh-error-configuration";
  readonly retryable: boolean = false;
}
export class MissingCredentialError extends ConfigurationError {
  override readonly code: string = "MISSING_CREDENTIAL";
  override readonly messageKey: string = "rh-error-missing-credential";
  constructor(readonly providerId: string) {
    super(`No API key configured for ${providerId}`, { providerId });
  }
}

/* ---- Network / transport ---- */
export class NetworkError extends ResearchHelperError {
  readonly code: string = "NETWORK";
  readonly messageKey: string = "rh-error-network";
  readonly retryable: boolean = true;
}
export class OfflineError extends NetworkError {
  override readonly code: string = "OFFLINE";
  override readonly messageKey: string = "rh-error-offline";
}
export class TimeoutError extends NetworkError {
  override readonly code: string = "TIMEOUT";
  override readonly messageKey: string = "rh-error-timeout";
  constructor(
    readonly timeoutMs: number,
    url: string,
  ) {
    super(`Request timed out after ${timeoutMs}ms`, {
      url: redactUrl(url),
      timeoutMs,
    });
  }
}

/* ---- Upstream HTTP ---- */
export abstract class UpstreamError extends ResearchHelperError {
  constructor(
    readonly httpStatus: number,
    message: string,
    ctx: Record<string, unknown> = {},
  ) {
    super(message, { ...ctx, httpStatus });
  }
}
export class AuthenticationError extends UpstreamError {
  // 401
  readonly code: string = "AUTHENTICATION";
  readonly messageKey: string = "rh-error-auth";
  readonly retryable: boolean = false;
}
export class AuthorizationError extends UpstreamError {
  // 403
  readonly code: string = "AUTHORIZATION";
  readonly messageKey: string = "rh-error-forbidden";
  readonly retryable: boolean = false;
}
export class RateLimitError extends UpstreamError {
  // 429
  readonly code: string = "RATE_LIMIT";
  readonly messageKey: string = "rh-error-rate-limit";
  readonly retryable: boolean = true;
  constructor(
    status: number,
    readonly retryAfterMs: number | undefined,
    host: string,
  ) {
    super(status, `Rate limited by ${host}`, { host, retryAfterMs });
  }
}
export class QuotaExceededError extends UpstreamError {
  readonly code: string = "QUOTA_EXCEEDED";
  readonly messageKey: string = "rh-error-quota";
  readonly retryable: boolean = false;
}
export class UpstreamServerError extends UpstreamError {
  // 5xx
  readonly code: string = "UPSTREAM_SERVER";
  readonly messageKey: string = "rh-error-upstream";
  readonly retryable: boolean = true;
}
export class BadRequestError extends UpstreamError {
  // 4xx other
  readonly code: string = "BAD_REQUEST";
  readonly messageKey: string = "rh-error-bad-request";
  readonly retryable: boolean = false;
  override readonly userFacing = false; // almost always our bug
}

/* ---- Adapter-level ---- */
export class SourceError extends ResearchHelperError {
  readonly code: string = "SOURCE";
  readonly messageKey: string = "rh-error-source";
  readonly retryable: boolean = false;
  constructor(
    readonly sourceId: string,
    message: string,
    ctx?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, { ...ctx, sourceId }, options);
  }
}
export class ParseError extends SourceError {
  override readonly code: string = "PARSE";
  override readonly messageKey: string = "rh-error-parse";
  override readonly userFacing = false;
}
export class LLMError extends ResearchHelperError {
  readonly code: string = "LLM";
  readonly messageKey: string = "rh-error-llm";
  readonly retryable: boolean = false;
  constructor(
    readonly providerId: string,
    readonly modelId: string,
    message: string,
    ctx?: Record<string, unknown>,
  ) {
    super(message, { ...ctx, providerId, modelId });
  }
}
export class ContextLengthExceededError extends LLMError {
  override readonly code: string = "CONTEXT_LENGTH";
  override readonly messageKey: string = "rh-error-context-length";
  // Handled internally by re-chunking before it ever reaches the user.
  override readonly userFacing = false;
}
export class ContentFilterError extends LLMError {
  override readonly code: string = "CONTENT_FILTER";
  override readonly messageKey: string = "rh-error-content-filter";
}
export class StructuredOutputError extends LLMError {
  override readonly code: string = "STRUCTURED_OUTPUT";
  override readonly messageKey: string = "rh-error-structured-output";
  override readonly retryable: boolean = true; // retried once with a repair prompt
  // Inherits LLMError's (providerId, modelId, message, ctx?) constructor and adds no
  // parameters. `12-prompt-library.md` §18.3's `parseOrRepair` is the canonical thrower and
  // passes the adapter's `id` and the model that produced the malformed output, in that
  // order, before the message. A two-argument `new StructuredOutputError(message, ctx)` does
  // not compile — and would strip exactly the two fields that make the report actionable.
}
export class TTSError extends ResearchHelperError {
  readonly code: string = "TTS";
  readonly messageKey: string = "rh-error-tts";
  readonly retryable: boolean = false;
}

/* ---- Zotero-side ---- */
export class ZoteroApiError extends ResearchHelperError {
  readonly code: string = "ZOTERO_API";
  readonly messageKey: string = "rh-error-zotero";
  readonly retryable: boolean = false;
}
export class StorageError extends ResearchHelperError {
  readonly code: string = "STORAGE";
  readonly messageKey: string = "rh-error-storage";
  readonly retryable: boolean = false;
}

/* ---- Control flow ---- */
export class OperationCancelledError extends ResearchHelperError {
  readonly code: string = "CANCELLED";
  readonly messageKey: string = "rh-error-cancelled";
  readonly retryable: boolean = false;
  override readonly userFacing = false; // cancellation is not an error to report
  constructor(readonly reason: CancellationReason) {
    super("Operation cancelled", { reason: reason.kind });
  }
}
export class BudgetExceededError extends ResearchHelperError {
  readonly code: string = "BUDGET_EXCEEDED";
  readonly messageKey: string = "rh-error-budget";
  readonly retryable: boolean = false;
}
export class PolicyViolationError extends ResearchHelperError {
  readonly code: string = "POLICY";
  readonly messageKey: string = "rh-error-policy";
  readonly retryable: boolean = false;
  // e.g. privacy mode forbids sending full text to a provider that may retain it.
}

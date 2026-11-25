import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  BudgetExceededError,
  ConfigurationError,
  ContentFilterError,
  ContextLengthExceededError,
  KEYISH_FIELD,
  KEY_PATTERNS,
  LLMError,
  loggableHeaders,
  MissingCredentialError,
  NetworkError,
  OfflineError,
  omitSecretFields,
  OperationCancelledError,
  OutputTruncatedError,
  ParseError,
  PolicyViolationError,
  PrivacyRoutingError,
  QuotaExceededError,
  RateLimitError,
  redact,
  redactUrl,
  ResearchHelperError,
  SourceError,
  StorageError,
  StructuredOutputError,
  teardownErrorLine,
  TimeoutError,
  TTSError,
  UpstreamServerError,
  ZoteroApiError,
} from "../../../src/core/errors";
import {
  DEFERRED_ERROR_MESSAGE_IDS,
  ERROR_MESSAGE_IDS,
  L10N_PROGRESS_HEADLINE,
} from "../../../src/i18n/keys";
import {
  redactRecord,
  redactSourceProvenance,
} from "../../../src/core/provenance";

/**
 * `P1-T02`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * The table below is the card's third acceptance criterion made mechanical:
 * "every class in `docs/07` §10.1 that Phase 1 uses exists with the exact `code`
 * string from that section". It covers all twenty-two classes §10.1 declares,
 * not only Phase 1's twelve, because the card's **Notes** require the hierarchy
 * to be transcribed in full and a partial table would let the Phase 3 subtree
 * drift unnoticed.
 */

/** One row per `docs/07` §10.1 class: the four values that section fixes. */
const HIERARCHY: readonly {
  readonly name: string;
  readonly instance: ResearchHelperError;
  readonly code: string;
  readonly messageKey: string;
  readonly retryable: boolean;
  readonly userFacing: boolean;
}[] = [
  {
    name: "ConfigurationError",
    instance: new ConfigurationError("x"),
    code: "CONFIGURATION",
    messageKey: "rh-error-configuration",
    retryable: false,
    userFacing: true,
  },
  {
    name: "MissingCredentialError",
    instance: new MissingCredentialError("openai"),
    code: "MISSING_CREDENTIAL",
    messageKey: "rh-error-missing-credential",
    retryable: false,
    userFacing: true,
  },
  {
    name: "NetworkError",
    instance: new NetworkError("x"),
    code: "NETWORK",
    messageKey: "rh-error-network",
    retryable: true,
    userFacing: true,
  },
  {
    name: "OfflineError",
    instance: new OfflineError("x"),
    code: "OFFLINE",
    messageKey: "rh-error-offline",
    retryable: true,
    userFacing: true,
  },
  {
    name: "TimeoutError",
    instance: new TimeoutError(60_000, "https://example.invalid/a"),
    code: "TIMEOUT",
    messageKey: "rh-error-timeout",
    retryable: true,
    userFacing: true,
  },
  {
    name: "AuthenticationError",
    instance: new AuthenticationError(401, "x"),
    code: "AUTHENTICATION",
    messageKey: "rh-error-auth",
    retryable: false,
    userFacing: true,
  },
  {
    name: "AuthorizationError",
    instance: new AuthorizationError(403, "x"),
    code: "AUTHORIZATION",
    messageKey: "rh-error-forbidden",
    retryable: false,
    userFacing: true,
  },
  {
    name: "RateLimitError",
    instance: new RateLimitError(429, 1_000, "eutils.ncbi.nlm.nih.gov"),
    code: "RATE_LIMIT",
    messageKey: "rh-error-rate-limit",
    retryable: true,
    userFacing: true,
  },
  {
    name: "QuotaExceededError",
    instance: new QuotaExceededError(402, "x"),
    code: "QUOTA_EXCEEDED",
    messageKey: "rh-error-quota",
    retryable: false,
    userFacing: true,
  },
  {
    name: "UpstreamServerError",
    instance: new UpstreamServerError(503, "x"),
    code: "UPSTREAM_SERVER",
    messageKey: "rh-error-upstream",
    retryable: true,
    userFacing: true,
  },
  {
    name: "BadRequestError",
    instance: new BadRequestError(400, "x"),
    code: "BAD_REQUEST",
    messageKey: "rh-error-bad-request",
    retryable: false,
    userFacing: false,
  },
  {
    // Owner, 2026-10-21 (`plan/00` §6 item 262(c)): OpenRouter's guardrail
    // 404, the one user-facing `BadRequestError`.
    name: "PrivacyRoutingError",
    instance: new PrivacyRoutingError(404, "x"),
    code: "PRIVACY_ROUTING",
    messageKey: "rh-error-privacy-routing",
    retryable: false,
    userFacing: true,
  },
  {
    name: "SourceError",
    instance: new SourceError("pubmed", "x"),
    code: "SOURCE",
    messageKey: "rh-error-source",
    retryable: false,
    userFacing: true,
  },
  {
    name: "ParseError",
    instance: new ParseError("pubmed", "x"),
    code: "PARSE",
    messageKey: "rh-error-parse",
    retryable: false,
    userFacing: false,
  },
  {
    name: "LLMError",
    instance: new LLMError("openai", "gpt-4o-mini", "x"),
    code: "LLM",
    messageKey: "rh-error-llm",
    retryable: false,
    userFacing: true,
  },
  {
    name: "ContextLengthExceededError",
    instance: new ContextLengthExceededError("openai", "gpt-4o-mini", "x"),
    code: "CONTEXT_LENGTH",
    messageKey: "rh-error-context-length",
    retryable: false,
    userFacing: false,
  },
  {
    name: "ContentFilterError",
    instance: new ContentFilterError("openai", "gpt-4o-mini", "x"),
    code: "CONTENT_FILTER",
    messageKey: "rh-error-content-filter",
    retryable: false,
    userFacing: true,
  },
  {
    name: "StructuredOutputError",
    instance: new StructuredOutputError("openai", "gpt-4o-mini", "x"),
    code: "STRUCTURED_OUTPUT",
    messageKey: "rh-error-structured-output",
    retryable: true,
    userFacing: true,
  },
  {
    // Owner, 2026-10-21 (`plan/00` §6 item 265(c)): a truncated answer.
    name: "OutputTruncatedError",
    instance: new OutputTruncatedError("openai", "gpt-4o-mini", "x"),
    code: "OUTPUT_TRUNCATED",
    messageKey: "rh-error-output-truncated",
    retryable: false,
    userFacing: true,
  },
  {
    name: "TTSError",
    instance: new TTSError("x"),
    code: "TTS",
    messageKey: "rh-error-tts",
    retryable: false,
    userFacing: true,
  },
  {
    name: "ZoteroApiError",
    instance: new ZoteroApiError("x"),
    code: "ZOTERO_API",
    messageKey: "rh-error-zotero",
    retryable: false,
    userFacing: true,
  },
  {
    name: "StorageError",
    instance: new StorageError("x"),
    code: "STORAGE",
    messageKey: "rh-error-storage",
    retryable: false,
    userFacing: true,
  },
  {
    name: "OperationCancelledError",
    instance: new OperationCancelledError({ kind: "user" }),
    code: "CANCELLED",
    messageKey: "rh-error-cancelled",
    retryable: false,
    userFacing: false,
  },
  {
    name: "BudgetExceededError",
    instance: new BudgetExceededError("x"),
    code: "BUDGET_EXCEEDED",
    messageKey: "rh-error-budget",
    retryable: false,
    userFacing: true,
  },
  {
    name: "PolicyViolationError",
    instance: new PolicyViolationError("x"),
    code: "POLICY",
    messageKey: "rh-error-policy",
    retryable: false,
    userFacing: true,
  },
];

describe("docs/07 §10.1 hierarchy", () => {
  it.each(HIERARCHY)(
    "$name carries §10.1's exact code, messageKey, retryable and userFacing",
    ({ instance, code, messageKey, retryable, userFacing }) => {
      expect(instance.code).toBe(code);
      expect(instance.messageKey).toBe(messageKey);
      expect(instance.retryable).toBe(retryable);
      expect(instance.userFacing).toBe(userFacing);
    },
  );

  it.each(HIERARCHY)(
    "$name is a ResearchHelperError and an Error",
    ({ instance }) => {
      expect(instance).toBeInstanceOf(ResearchHelperError);
      expect(instance).toBeInstanceOf(Error);
    },
  );

  it.each(HIERARCHY)(
    "$name sets name to its own class name",
    ({ name, instance }) => {
      // §10.1's `this.name = new.target.name`. Without it every entry in the
      // debug log would read "Error", and §10.2's developer column would lose the
      // one field that says which arm was taken.
      expect(instance.name).toBe(name);
    },
  );

  it("gives every class a distinct code", () => {
    const codes = HIERARCHY.map((row) => row.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every messageKey the rh-error- prefix NFR-14 requires", () => {
    // docs/10 NFR-14: "no bare 'An error occurred'" — every error carries a
    // Fluent message ID, never an English sentence.
    for (const { messageKey } of HIERARCHY) {
      expect(messageKey).toMatch(/^rh-error-[a-z-]+$/);
    }
  });

  it("ships a message for every class's messageKey, deferring none (P7-T12)", () => {
    // `plan/10` `P7-T12`'s `Done when`: `DEFERRED_ERROR_MESSAGE_IDS` is empty,
    // so every key in this table is a shipped error id. Its wording is held by
    // test/unit/i18n/errorMessages.test.ts.
    expect(DEFERRED_ERROR_MESSAGE_IDS).toEqual([]);
    const shipped: readonly string[] = ERROR_MESSAGE_IDS;
    const unshipped = HIERARCHY.map((row) => row.messageKey).filter(
      (key) => !shipped.includes(key),
    );
    expect(unshipped).toEqual([]);
  });

  describe("inheritance §10.1 declares", () => {
    it("makes PrivacyRoutingError a BadRequestError that is user-facing, and leaves BadRequestError log-only", () => {
      const routing = new PrivacyRoutingError(404, "x", { modelId: "m" });
      expect(routing).toBeInstanceOf(BadRequestError);
      expect(routing.httpStatus).toBe(404);
      expect(routing.toSerialized()).toMatchObject({
        code: "PRIVACY_ROUTING",
        messageKey: "rh-error-privacy-routing",
        httpStatus: 404,
        retryable: false,
      });
      expect(new BadRequestError(404, "x").userFacing).toBe(false);
    });

    it("makes OutputTruncatedError an LLMError that keeps the provider and model", () => {
      const cut = new OutputTruncatedError("openrouter", "m", "x", {
        finishReason: "length",
      });
      expect(cut).toBeInstanceOf(LLMError);
      expect(cut.providerId).toBe("openrouter");
      expect(cut.modelId).toBe("m");
      expect(cut.toSerialized()).toMatchObject({
        code: "OUTPUT_TRUNCATED",
        messageKey: "rh-error-output-truncated",
        retryable: false,
      });
      expect(cut.context).toMatchObject({
        finishReason: "length",
        providerId: "openrouter",
        modelId: "m",
      });
    });

    it("makes MissingCredentialError a ConfigurationError", () => {
      expect(new MissingCredentialError("openai")).toBeInstanceOf(
        ConfigurationError,
      );
    });

    it("makes OfflineError and TimeoutError NetworkErrors", () => {
      expect(new OfflineError("x")).toBeInstanceOf(NetworkError);
      expect(new TimeoutError(1, "https://example.invalid/")).toBeInstanceOf(
        NetworkError,
      );
    });

    it("makes ParseError a SourceError", () => {
      expect(new ParseError("pubmed", "x")).toBeInstanceOf(SourceError);
    });

    it("makes the three structured-output arms LLMErrors", () => {
      const args = ["openai", "gpt-4o-mini", "x"] as const;
      expect(new ContextLengthExceededError(...args)).toBeInstanceOf(LLMError);
      expect(new ContentFilterError(...args)).toBeInstanceOf(LLMError);
      expect(new StructuredOutputError(...args)).toBeInstanceOf(LLMError);
    });
  });

  describe("constructor-captured fields", () => {
    it("puts httpStatus in the context of every UpstreamError", () => {
      expect(new UpstreamServerError(503, "gateway").context).toMatchObject({
        httpStatus: 503,
      });
    });

    it("keeps RateLimitError's host and retryAfterMs", () => {
      const e = new RateLimitError(429, 2_500, "eutils.ncbi.nlm.nih.gov");
      expect(e.retryAfterMs).toBe(2_500);
      expect(e.httpStatus).toBe(429);
      expect(e.context).toMatchObject({
        host: "eutils.ncbi.nlm.nih.gov",
        retryAfterMs: 2_500,
      });
    });

    it("keeps SourceError's sourceId and its cause", () => {
      const cause = new Error("underlying");
      const e = new SourceError(
        "pubmed",
        "efetch failed",
        { page: 3 },
        { cause },
      );
      expect(e.sourceId).toBe("pubmed");
      expect(e.context).toMatchObject({ sourceId: "pubmed", page: 3 });
      expect(e.cause).toBe(cause);
    });

    it("keeps LLMError's providerId and modelId", () => {
      const e = new StructuredOutputError("openai", "gpt-4o-mini", "bad JSON");
      expect(e.providerId).toBe("openai");
      expect(e.modelId).toBe("gpt-4o-mini");
    });

    it("freezes the context so a later mutation cannot rewrite a log", () => {
      const e = new NetworkError("x", { host: "a" });
      expect(Object.isFrozen(e.context)).toBe(true);
    });
  });
});

describe("redact (docs/09 §2.1)", () => {
  // One case per KEY_PATTERNS entry, in the order docs/09 §2.1 lists them. The
  // label is first so the secret does not end up in the test name.
  it.each([
    ["Anthropic", "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
    ["OpenRouter", `sk-or-v1-${"a".repeat(40)}`],
    ["OpenAI project", `sk-proj-${"B".repeat(30)}`],
    ["OpenAI legacy", `sk-${"c".repeat(40)}`],
    ["Google", `AIza${"D".repeat(35)}`],
    ["bearer token", `Bearer ${"e".repeat(30)}`],
    ["unprefixed hexadecimal", "0123456789abcdef".repeat(2)],
    ["long opaque run", "f".repeat(48)],
  ])("removes a %s-shaped key", (_label, secret) => {
    const out = redact(`request failed with ${secret} attached`);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[redacted:\d+\]/);
  });

  it("reports the length of what it removed", () => {
    expect(redact("g".repeat(44))).toBe("[redacted:44]");
  });

  it("leaves ordinary text alone", () => {
    const msg = "esearch returned 250 hits for CRISPR base editing";
    expect(redact(msg)).toBe(msg);
  });

  it("redacts every occurrence, not just the first", () => {
    const secret = `sk-${"h".repeat(40)}`;
    const out = redact(`${secret} then ${secret}`);
    expect(out).not.toContain(secret);
    expect(out.match(/\[redacted:\d+\]/g)).toHaveLength(2);
  });

  it("is stable across calls despite the /g flags", () => {
    // KEY_PATTERNS carry /g and therefore lastIndex. `String.replace` resets it;
    // a `.test()` on the same objects would not, and the second call would miss.
    const secret = `AIza${"J".repeat(35)}`;
    expect(redact(secret)).toBe(redact(secret));
  });
});

/**
 * `P1-T42`. The catch-all's floor, the hexadecimal shape, and the residual gap
 * — asserted in both directions, so what `docs/09` §2.1 documents as redacted
 * is redacted and what it documents as *passing* is proven to pass.
 *
 * Every credential-shaped value here is a repeated `0123456789abcdef`, built in
 * this file. It is the shape `P1-T17` measured for an NCBI key and nobody's key.
 */
describe("the catch-all's floor and the hexadecimal shape (P1-T42)", () => {
  /** 32 hexadecimal characters — the length `P1-T17` measured. */
  const HEX_32 = "0123456789abcdef".repeat(2);

  it.each([32, 36, 39])(
    "redacts an unprefixed %i-character hexadecimal run in free text",
    (length) => {
      // 32 is P1-T17's measurement, 36 is pubmed-source.test.ts's, 39 is the
      // last length the catch-all does not reach. The text is the shape
      // P1-T09's efetch failure message has: a query string in a sentence.
      const run = "0123456789abcdef".repeat(3).slice(0, length);
      expect(redact(`efetch failed for db=pubmed&api_key=${run}&tool=rh`)).toBe(
        `efetch failed for db=pubmed&api_key=[redacted:${length}]&tool=rh`,
      );
    },
  );

  it("redacts it inside the sentence docs/08 §4.6's empty-state headline draws", () => {
    // P1-T22 left the headline unpopulated because this shape passed redact().
    // The card asked for that claim to be checked rather than inherited.
    const out = redact(`No papers found for “${HEX_32}” in 2024–2026.`);
    expect(out).toBe("No papers found for “[redacted:32]” in 2024–2026.");
  });

  it("still passes a 32-character run that is not hexadecimal — the residual gap", () => {
    // `g` and `h` are outside [0-9a-fA-F]. docs/09 §2.1 documents this as
    // passing, which is why the headline stays omitted: the shape closes the
    // NCBI case, not the general one.
    const run = "gh".repeat(16);
    expect(run).toHaveLength(32);
    const sentence = `No papers found for “${run}” in 2024–2026.`;
    expect(redact(sentence)).toBe(sentence);
  });

  it("still passes a 31-character hexadecimal run — the shape's floor", () => {
    const run = HEX_32.slice(0, 31);
    expect(redact(`got ${run} back`)).toBe(`got ${run} back`);
  });

  it("keeps the catch-all's floor at exactly 40", () => {
    // Measured 2026-10-13: a floor of 39 would redact seven shipped Fluent
    // message ids; raising it is forbidden by the card. Both edges pinned.
    expect(redact("x".repeat(39))).toBe("x".repeat(39));
    expect(redact("x".repeat(40))).toBe("[redacted:40]");
  });

  it("leaves a shipped 33-character Fluent message id intact", () => {
    // The class of legitimate run the measurement found most often between 32
    // and 39 characters. Imported from the shipped list so the assertion
    // follows the bundle rather than a copy of it.
    expect(L10N_PROGRESS_HEADLINE).toHaveLength(33);
    const msg = `headline ${L10N_PROGRESS_HEADLINE} resolved`;
    expect(redact(msg)).toBe(msg);
  });

  it("is idempotent with the hexadecimal shape", () => {
    // provenance.ts redacts again at the export boundary; the marker the shape
    // leaves must match nothing, including itself.
    const once = redact(`key ${HEX_32}0123 sent`);
    expect(once).toBe("key [redacted:36] sent");
    expect(redact(once)).toBe(once);
  });

  it("requires a word boundary, so a hexadecimal tail inside a longer word is the catch-all's", () => {
    // searchImportViewModel-export.test.ts builds a 48-character run that
    // *starts* with two non-hexadecimal letters. Without `\b` the shape would
    // eat the 46-character tail and leave `rh[redacted:46]`.
    expect(redact(`rh${HEX_32}bbbbbbbbbbbbbb`)).toBe("[redacted:48]");
  });
});

/**
 * `P1-T42`'s fourth criterion made mechanical: "No second redaction rule exists
 * anywhere; `grep` for the pattern shapes finds them in one module." The one
 * place the shapes are *printed* outside `src/core/errors.ts` is `docs/09`
 * §2.1's normative block, which the module's header says it transcribes
 * verbatim. This compares the two, entry by entry and in order, so a shape
 * added to one and not the other fails here rather than in a bug report.
 */
describe("docs/09 §2.1 and src/core/errors.ts hold one pattern set", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const doc = readFileSync(
    resolve(repoRoot, "docs/09-security-privacy-and-api-keys.md"),
    "utf8",
  );

  /** `/…/flags` as a regex literal prints; `.source` escapes `/`, the doc does not. */
  const literalOf = (re: RegExp): string =>
    `/${re.source.replaceAll("\\/", "/")}/${re.flags}`;

  it("prints every KEY_PATTERNS entry, in the code's order", () => {
    const start = doc.indexOf("const KEY_PATTERNS: readonly RegExp[] = [");
    expect(start).toBeGreaterThan(-1);
    const block = doc.slice(start, doc.indexOf("];", start));
    const printed = [...block.matchAll(/^\s*(\/.*?\/[a-z]*),/gm)].map(
      (m) => m[1],
    );
    expect(printed).toEqual(KEY_PATTERNS.map(literalOf));
  });

  it("prints the same KEYISH_FIELD", () => {
    expect(doc).toContain(`const KEYISH_FIELD = ${literalOf(KEYISH_FIELD)};`);
  });
});

/**
 * `P1-T42` step 4: the re-render technique, lifted from
 * `src/sources/pubmed/pubmedSource.ts` into the module that holds the patterns.
 */
describe("omitSecretFields (docs/09 §2.1, P1-T42)", () => {
  // A fresh object per call, not a shared constant: a mutant that deletes the
  // secret from the *caller's* object escaped the first sweep because every
  // earlier test had already damaged the shared fixture before the
  // no-mutation test copied it as its "before".
  const values = () => ({
    db: "pubmed",
    id: "1,2,3",
    api_key: "0123456789abcdef".repeat(2),
    tool: "rh",
    email: "dev@example.invalid",
  });

  it("removes every KEYISH_FIELD-named entry and keeps the rest in order", () => {
    expect(Object.keys(omitSecretFields(values()))).toEqual([
      "db",
      "id",
      "tool",
      "email",
    ]);
  });

  it("removes rather than blanks, for redactUrl's reason", () => {
    // `api_key=` with nothing after it still says the request carried a key.
    const out = omitSecretFields(values());
    expect("api_key" in out).toBe(false);
    expect(Object.values(out)).not.toContain("");
  });

  it.each(["API_KEY", "apiKey", "x-api-key", "Authorization", "access_token"])(
    "drops %s whatever its value, by the field-name rule",
    (name) => {
      expect(omitSecretFields({ [name]: "v", db: "pubmed" })).toEqual({
        db: "pubmed",
      });
    },
  );

  it("renders a form body with no trace of the key", () => {
    // The caller's renderer, applied to the omitted map — the second render
    // pubmedSource.ts's buildEfetchRequest does inline.
    const body = new URLSearchParams(omitSecretFields(values())).toString();
    expect(body).toBe(
      "db=pubmed&id=1%2C2%2C3&tool=rh&email=dev%40example.invalid",
    );
    expect(body).not.toContain("api_key");
  });

  it("does not mutate the caller's values", () => {
    const input = values();
    omitSecretFields(input);
    expect(input).toEqual(values());
    expect("api_key" in input).toBe(true);
  });
});

/**
 * `P3-T01` step 2: `docs/09` §2.1 level 3, "headers are structurally
 * excluded". Every key below is synthetic and built at run time.
 */
describe("loggableHeaders (docs/09 §2.1 level 3, P3-T01)", () => {
  it("redacts Authorization by name and leaves application/json unchanged", () => {
    const out = loggableHeaders({
      Authorization: "Bearer " + "x".repeat(40),
      Accept: "application/json",
    });
    expect(out).toEqual({
      Authorization: "[redacted:47]",
      Accept: "application/json",
    });
  });

  it.each(["x-api-key", "x-goog-api-key", "Authorization", "authorization"])(
    "redacts a %s value too short for any KEY_PATTERNS shape",
    (name) => {
      // Ten characters: no vendor prefix, below the hexadecimal shape and the
      // catch-all, so only the field-name rule can catch it.
      const value = "k".repeat(10);
      expect(redact(value)).toBe(value);
      expect(loggableHeaders({ [name]: value })).toEqual({
        [name]: "[redacted:10]",
      });
    },
  );

  it("runs every other value through redact(), the one redactor", () => {
    const samples = [
      "see sk-ant-" + "x".repeat(30) + " here",
      "0123456789abcdef".repeat(2),
      "z".repeat(40),
      "f".repeat(31),
      "text/event-stream",
    ];
    for (const value of samples) {
      expect(loggableHeaders({ "X-Note": value })["X-Note"]).toBe(
        redact(value),
      );
    }
    expect(loggableHeaders({ "X-Note": samples[0] ?? "" })).toEqual({
      "X-Note": "see [redacted:37] here",
    });
  });

  it("keeps every header name, in order, and leaves the input untouched", () => {
    const input = {
      "Content-Type": "application/json",
      "x-api-key": "k".repeat(12),
      "User-Agent": "research-helper/0.0.2",
    };
    const before = { ...input };
    const out = loggableHeaders(input);
    expect(Object.keys(out)).toEqual(Object.keys(input));
    expect(input).toEqual(before);
    expect(out).not.toBe(input);
  });
});

/**
 * `P3-T01` **Done when**: "`KEY_PATTERNS` still has exactly eight entries and
 * no new pattern exists anywhere in `src/`". `docs/09` §2.1 has one redactor;
 * this asserts no second one grew beside it.
 *
 * Every `.ts` file under `src/` is parsed with the TypeScript compiler, and
 * every regular-expression literal and every `RegExp(...)` argument outside
 * `src/core/errors.ts` is checked for a credential fingerprint — a vendor
 * prefix, a `Bearer` match, or one of `KEY_PATTERNS`' run lengths. Parsing,
 * not grepping, because comments may legitimately quote a pattern (one in
 * `src/ui/viewModels/searchImportViewModel.ts` does).
 */
describe("one redactor in src/ (docs/09 §2.1, P3-T01)", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const srcDir = resolve(repoRoot, "src");
  const ERRORS = "src/core/errors.ts";

  /** Every regex the tree declares, with the file it is in. */
  const found: { readonly file: string; readonly text: string }[] = [];
  /** Files declaring an identifier the redactor owns. */
  const declarers: { readonly file: string; readonly name: string }[] = [];
  const OWNED = new Set([
    "KEY_PATTERNS",
    "KEYISH_FIELD",
    "redact",
    "loggableHeaders",
  ]);

  for (const entry of readdirSync(srcDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const path = join(entry.parentPath, entry.name);
    const file = relative(repoRoot, path).replaceAll("\\", "/");
    const sf = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
        found.push({ file, text: node.getText(sf) });
      } else if (
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        node.expression.getText(sf) === "RegExp"
      ) {
        found.push({ file, text: node.arguments?.[0]?.getText(sf) ?? "" });
      } else if (
        (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) &&
        node.name !== undefined &&
        ts.isIdentifier(node.name) &&
        OWNED.has(node.name.text)
      ) {
        declarers.push({ file, name: node.name.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  /** `KEY_PATTERNS`' distinguishing pieces: prefixes and run lengths. */
  const FINGERPRINTS = [
    "sk-",
    "AIza",
    "Bearer",
    "{20,}",
    "{32,}",
    "{35}",
    "{40,}",
  ];

  it("keeps exactly eight KEY_PATTERNS entries", () => {
    expect(KEY_PATTERNS).toHaveLength(8);
  });

  it("finds the eight patterns in src/core/errors.ts, so the scan is live", () => {
    const own = found.filter((r) => r.file === ERRORS).map((r) => r.text);
    for (const re of KEY_PATTERNS) {
      expect(own).toContain(`/${re.source}/${re.flags}`);
    }
  });

  it("declares no credential pattern anywhere else in src/", () => {
    const sources = new Set(KEY_PATTERNS.map((re) => re.source));
    const offenders = found.filter(
      (r) =>
        r.file !== ERRORS &&
        (FINGERPRINTS.some((f) => r.text.includes(f)) ||
          [...sources].some((s) => r.text.includes(s))),
    );
    expect(offenders).toEqual([]);
  });

  it("declares KEY_PATTERNS, KEYISH_FIELD, redact and loggableHeaders only in src/core/errors.ts", () => {
    expect(declarers.filter((d) => d.file !== ERRORS)).toEqual([]);
    expect(declarers.map((d) => d.name).sort()).toEqual([...OWNED].sort());
  });
});

describe("redactUrl (docs/07 §10.3, docs/09 §2.1)", () => {
  it.each(["key", "api_key", "apikey", "token", "access_token"])(
    "strips the %s parameter",
    (param) => {
      const out = redactUrl(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&${param}=abc123`,
      );
      expect(out).not.toContain("abc123");
      expect(out).not.toContain(param);
      expect(out).toContain("db=pubmed");
    },
  );

  it("strips a short key no content pattern could catch", () => {
    // This is the whole reason the parameter rule exists: "abc123" matches none
    // of KEY_PATTERNS, so `redact()` alone would publish it.
    expect(redact("?api_key=abc123")).toContain("abc123");
    expect(redactUrl("https://x.invalid/a?api_key=abc123")).not.toContain(
      "abc123",
    );
  });

  it("matches the parameter name case-insensitively", () => {
    expect(redactUrl("https://x.invalid/a?API_KEY=abc123")).not.toContain(
      "abc123",
    );
  });

  it("keeps a URL with no secret parameter readable", () => {
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=crispr";
    expect(redactUrl(url)).toBe(url);
  });

  it("still redacts a key-shaped path segment", () => {
    const secret = "k".repeat(44);
    expect(redactUrl(`https://x.invalid/v1/${secret}/models`)).not.toContain(
      secret,
    );
  });

  it("falls back to redact() on an unparseable input", () => {
    const secret = `sk-ant-${"m".repeat(30)}`;
    expect(redactUrl(`not a url ${secret}`)).not.toContain(secret);
  });
});

describe("KEYISH_FIELD", () => {
  it.each([
    "api_key",
    "apiKey",
    "api-key",
    "x-api-key",
    "Authorization",
    "authorization",
    "token",
    "access_token",
    "secret",
    "password",
    "bearer",
    "credential",
  ])("matches the %s field name", (name) => {
    expect(KEYISH_FIELD.test(name)).toBe(true);
  });

  it.each(["host", "status", "url", "sourceId", "model", "ms"])(
    "does not match the ordinary field name %s",
    (name) => {
      expect(KEYISH_FIELD.test(name)).toBe(false);
    },
  );

  it("is not global, so .test() is safe to repeat", () => {
    // KEY_PATTERNS are /g and stateful; this one is used with .test() by the
    // logger on every context key, so it must not be.
    expect(KEYISH_FIELD.global).toBe(false);
    expect(KEY_PATTERNS.every((re) => re.global)).toBe(true);
  });
});

describe("toSerialized (docs/07 §5.2, §10.1)", () => {
  it("redacts the developer-facing detail", () => {
    const secret = `sk-${"n".repeat(40)}`;
    const serialized = new NetworkError(
      `POST failed, sent ${secret}`,
    ).toSerialized();
    expect(serialized.detail).not.toContain(secret);
    expect(serialized.detail).toContain("[redacted:");
  });

  it("carries §5.2's four required fields", () => {
    const serialized = new UpstreamServerError(
      503,
      "bad gateway",
    ).toSerialized();
    expect(serialized).toMatchObject({
      code: "UPSTREAM_SERVER",
      messageKey: "rh-error-upstream",
      detail: "bad gateway",
      retryable: true,
    });
  });

  it("includes httpStatus when the error has one", () => {
    expect(
      new AuthenticationError(401, "rejected").toSerialized().httpStatus,
    ).toBe(401);
  });

  it("omits httpStatus entirely when the error has none", () => {
    // Absent, not `undefined`: this object is serialized into
    // schema/provenance.schema.json's `error` field (§5.3) and an explicit null
    // is a case every consumer would have to special-case.
    const serialized = new StorageError("disk full").toSerialized();
    expect("httpStatus" in serialized).toBe(false);
  });

  it("includes a stack", () => {
    const { stack } = new ZoteroApiError("x").toSerialized();
    expect(typeof stack).toBe("string");
    expect(stack).toContain("errors.test.ts");
  });

  it("redacts a key that reached the stack-bearing message", () => {
    const secret = `AIza${"P".repeat(35)}`;
    const serialized = new TimeoutError(
      1_000,
      `https://x.invalid/a?key=${secret}`,
    ).toSerialized();
    expect(JSON.stringify(serialized)).not.toContain(secret);
  });

  it("redacts the URL TimeoutError captured into its context", () => {
    const e = new TimeoutError(
      60_000,
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&api_key=abc123",
    );
    expect(JSON.stringify(e.context)).not.toContain("abc123");
    expect(e.timeoutMs).toBe(60_000);
  });
});

/**
 * `P7-T36` (owner, 2026-11-17, `plan/00` §6 item 395(d)): the add-on's
 * teardown reporter, `src/addon.ts`'s `onError`, writes its line through
 * {@link redact}. Every key-shaped value is built here, at run time, from a
 * repeated character: none is anybody's key.
 */
describe("teardownErrorLine (P7-T36, item 395(d))", () => {
  const planted = `sk-or-v1-${"k".repeat(40)}`;

  it("redacts a key planted in a thrown teardown error's message and stack", () => {
    const error = new Error(`provider refused ${planted}`);
    error.stack = `Error: provider refused ${planted}\n    at teardown (chrome://x.js:1:1)`;
    const line = teardownErrorLine(
      "Research Helper",
      "service dispose failed",
      error,
    );
    expect(line).not.toContain(planted);
    expect(line).not.toContain("k".repeat(40));
    expect(line.match(/\[redacted:49\]/g)).toHaveLength(2);
    expect(
      line.startsWith(
        "[Research Helper] service dispose failed: provider refused ",
      ),
    ).toBe(true);
    expect(line).toContain("at teardown (chrome://x.js:1:1)");
  });

  it("redacts a key in something thrown that is not an Error, and in the scope's own message", () => {
    const bearer = `Bearer ${"t".repeat(30)}`;
    expect(teardownErrorLine("RH", "dispose", bearer)).toBe(
      "[RH] dispose: [redacted:37]",
    );
    expect(teardownErrorLine("RH", `closing ${planted}`, 1)).toBe(
      "[RH] closing [redacted:49]: 1",
    );
  });

  it("keeps an ordinary line as it was, and says when there is no stack", () => {
    const error = new Error("database is locked");
    Object.defineProperty(error, "stack", { value: undefined });
    expect(teardownErrorLine("RH", "close", error)).toBe(
      "[RH] close: database is locked\n(no stack)",
    );
    expect(teardownErrorLine("RH", "close", undefined)).toBe(
      "[RH] close: undefined",
    );
  });

  it("is what src/addon.ts's onError writes", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/addon.ts"),
      "utf8",
    );
    const sf = ts.createSourceFile(
      "addon.ts",
      source,
      ts.ScriptTarget.ES2022,
      true,
    );
    let reporter: ts.Node | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "onError"
      ) {
        reporter = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (reporter === undefined) throw new Error("no onError in src/addon.ts");
    const body = reporter.getText(sf).replace(/\s+/g, " ");
    expect(body).toContain(
      "Zotero.debug(teardownErrorLine(config.addonName, message, error))",
    );
    // Nothing else in the reporter writes to the debug output.
    expect(body.match(/Zotero\.debug\(/g)).toHaveLength(1);
  });
});

/**
 * `P1-T37` (2026-11-25): `SerializedError` carries two named members of a
 * transport error — the request's host name and the timeout in seconds — and
 * **nothing else of the thrower's `context`**.
 *
 * Every planted value below is built here from repeated characters or a
 * made-up account name: none is anybody's key or path. The test that matters
 * is the negative one: a key, a query string, a request path, a user's file
 * path, an export path and a linked audio folder are each put into an error's
 * context, and none may come out of the projection, out of `redactRecord` (the
 * gate a `JobRecord.error` passes before it is stored), or out of the
 * provenance gate. It fails if the whole context is carried instead of the two
 * members.
 */
describe("P1-T37: the host and the seconds, and nothing else of the context", () => {
  const KEY = `${"ab12".repeat(8)}`; // 32 hexadecimal characters, NCBI's shape
  const OPAQUE_KEY = `sk-or-v1-${"k".repeat(40)}`;
  const QUERY = "term=planted-query-words";
  const REQUEST_PATH = "/entrez/eutils/esearch.fcgi";
  const USER_PATH =
    "C:\\Users\\planted-user\\Zotero\\storage\\ABCD1234\\paper.pdf";
  const EXPORT_PATH =
    "C:\\Users\\planted-user\\Desktop\\provenance-export.json";
  const AUDIO_FOLDER = "D:\\planted-audio-folder\\briefings";
  const URL_PLANTED = `https://eutils.ncbi.nlm.nih.gov${REQUEST_PATH}?${QUERY}&api_key=${KEY}`;
  const PLANTED = [
    KEY,
    OPAQUE_KEY,
    QUERY,
    "planted-query-words",
    REQUEST_PATH,
    // Not "esearch" alone: the serialized `stack` names this repository's
    // folder, `research_helper`, which contains it.
    "esearch.fcgi",
    "api_key",
    USER_PATH,
    "planted-user",
    EXPORT_PATH,
    "provenance-export",
    AUDIO_FOLDER,
    "planted-audio-folder",
  ];

  /** A context of the kind the brief forbids carrying: the URL plus three paths. */
  const context = (): Record<string, unknown> => ({
    url: URL_PLANTED,
    method: "GET",
    file: USER_PATH,
    exportPath: EXPORT_PATH,
    audioFolder: AUDIO_FOLDER,
    token: OPAQUE_KEY,
  });

  const errors = (): readonly ResearchHelperError[] => [
    new NetworkError("transport failed", context()),
    new OfflineError("offline", context()),
    new TimeoutError(45_000, URL_PLANTED),
  ];

  const expectNonePlanted = (text: string, where: string): void => {
    for (const planted of PLANTED) {
      expect(text, `${where} carries ${planted}`).not.toContain(planted);
    }
  };

  it("carries the host name, and none of the planted values, in the projection", () => {
    for (const error of errors()) {
      const serialized = error.toSerialized();
      expect(serialized.host, error.code).toBe("eutils.ncbi.nlm.nih.gov");
      expectNonePlanted(
        JSON.stringify(serialized),
        `${error.code}'s projection`,
      );
      // Exactly §5.2's members plus the two this card adds; no context.
      for (const member of Object.keys(serialized)) {
        expect(
          [
            "code",
            "messageKey",
            "detail",
            "retryable",
            "httpStatus",
            "stack",
            "host",
            "timeoutSeconds",
          ],
          `${error.code} carries ${member}`,
        ).toContain(member);
      }
    }
  });

  it("carries a timeout's seconds, whole, and only on a TimeoutError", () => {
    expect(
      new TimeoutError(45_000, URL_PLANTED).toSerialized().timeoutSeconds,
    ).toBe(45);
    expect(
      new TimeoutError(400, URL_PLANTED).toSerialized().timeoutSeconds,
    ).toBe(1);
    expect(
      "timeoutSeconds" in new NetworkError("x", context()).toSerialized(),
    ).toBe(false);
    expect(
      "timeoutSeconds" in
        new TimeoutError(Number.NaN, URL_PLANTED).toSerialized(),
    ).toBe(false);
  });

  it("reads the host of the pipeline's per-source deadline, which throws with a bare rateLimitKey", () => {
    // `src/pipeline/searchImport/stages.ts`: `new TimeoutError(timeoutMs,
    // source.rateLimitKey)`, and a `rateLimitKey` is a host, not a URL.
    const serialized = new TimeoutError(
      30_000,
      "eutils.ncbi.nlm.nih.gov",
    ).toSerialized();
    expect(serialized.host).toBe("eutils.ncbi.nlm.nih.gov");
    expect(serialized.timeoutSeconds).toBe(30);
  });

  it("carries no host for a context whose URL names none, and none on any other class", () => {
    for (const url of [
      USER_PATH,
      `file:///${USER_PATH.replace(/\\/g, "/")}`,
      "/a/relative/path?x=1",
      AUDIO_FOLDER,
      "",
    ]) {
      const serialized = new NetworkError("x", { url }).toSerialized();
      expect("host" in serialized, url).toBe(false);
      expectNonePlanted(JSON.stringify(serialized), url);
    }
    expect("host" in new NetworkError("x", { url: 42 }).toSerialized()).toBe(
      false,
    );
    expect("host" in new NetworkError("x").toSerialized()).toBe(false);
    // `RateLimitError` takes a host too, but as a constructor argument that
    // reaches `context` only: this card carries none for it, on purpose
    // (`UNRENDERABLE_ERROR_ROWS`' record in the view model).
    expect(
      "host" in
        new RateLimitError(
          429,
          30_000,
          "eutils.ncbi.nlm.nih.gov",
        ).toSerialized(),
    ).toBe(false);
    expect(
      "host" in new ConfigurationError("x", context()).toSerialized(),
    ).toBe(false);
  });

  it("redacts a key-shaped label even inside a host name", () => {
    const serialized = new NetworkError("x", {
      url: `https://${OPAQUE_KEY}.example.test/v1`,
    }).toSerialized();
    expect(serialized.host).toBeDefined();
    expect(serialized.host).not.toContain(OPAQUE_KEY);
    expect(serialized.host).toContain("[redacted:");
  });

  it("persists none of the planted values: a job record's error through redactRecord, a source's through the provenance gate", () => {
    for (const error of errors()) {
      const serialized = error.toSerialized();
      const { record } = redactRecord({ error: serialized });
      expectNonePlanted(
        JSON.stringify(record),
        `${error.code} after redactRecord`,
      );
      expect(record.error.host, error.code).toBe("eutils.ncbi.nlm.nih.gov");

      const provenance = redactSourceProvenance({
        sourceId: "pubmed",
        endpointBaseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
        transmittedQuery: "",
        transmittedUrl: "",
        dateFilterApplied: "none",
        requestedLimit: 10,
        rawHitCount: undefined,
        recordsRetrieved: 0,
        recordsDeduplicatedAway: 0,
        recordsImported: 0,
        error: serialized,
        sourceExtras: undefined,
      });
      expectNonePlanted(
        JSON.stringify(provenance),
        `${error.code} in provenance`,
      );
      // The provenance gate copies only the members it names, so the two new
      // ones stay out of `schema/provenance.schema.json`'s closed object.
      expect(provenance.error && "host" in provenance.error, error.code).toBe(
        false,
      );
    }
  });
});

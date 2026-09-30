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
  MissingCredentialError,
  NetworkError,
  OfflineError,
  OperationCancelledError,
  ParseError,
  PolicyViolationError,
  QuotaExceededError,
  RateLimitError,
  redact,
  redactUrl,
  ResearchHelperError,
  SourceError,
  StorageError,
  StructuredOutputError,
  TimeoutError,
  TTSError,
  UpstreamServerError,
  ZoteroApiError,
} from "../../../src/core/errors";

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

  describe("inheritance §10.1 declares", () => {
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

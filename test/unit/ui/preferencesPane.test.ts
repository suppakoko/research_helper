import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  QuotaExceededError,
  RateLimitError,
  TimeoutError,
  UpstreamServerError,
} from "../../../src/core/errors";
import type { HttpRequest, HttpResponse } from "../../../src/core/http/client";
import {
  MAINTAINER_EMAIL,
  NCBI_EUTILS_HOST,
  TOOL_NAME,
} from "../../../src/core/http/userAgent";
import { createLogger, type LogSink } from "../../../src/core/logger";
import {
  SECRET_IDS,
  type SecretId,
  type SecretStore,
} from "../../../src/core/secretStore";
import { MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import { DEFAULT_BASE_URLS } from "../../../src/llm/shared/baseUrl";
import type { ProviderId } from "../../../src/model/ids";
import { PREF_KEYS, qualifiedPrefKey } from "../../../src/prefs/keys";
import { PREFS } from "../../../src/prefs/schema";
import {
  LLM_CREDENTIALS,
  MIN_DIGEST_KEY_LENGTH,
  NCBI_TEST_PMID,
  NCBI_TEST_URL,
  OS_KEYSTORE_PREF_VALUE,
  PANE_CREDENTIALS,
  PREFERENCES_L10N,
  PREFERENCES_PANE_ID,
  PREFERENCES_PANE_SCRIPT,
  PREFERENCES_PANE_SRC,
  PREFERENCES_ROOT_ID,
  SEMANTIC_SCHOLAR_RETRY_DELAY_MS,
  SEMANTIC_SCHOLAR_TEST_URL,
  SESSION_PREF_VALUE,
  SOURCE_CREDENTIALS,
  backendBadge,
  checkBaseUrlInput,
  classifyFailure,
  classifyNcbiResponse,
  classifySemanticScholarResponse,
  createPreferencesHost,
  isPaneCredential,
  isTestableCredential,
  keyDigest,
  ncbiTestRequest,
  normalizeKeyInput,
  preferencePaneOptions,
  riskOpeningMessageId,
  riskOwnAccountMessageId,
  semanticScholarTestRequest,
  showRestoreNotice,
  type BaseUrlResult,
  type PreferencesHostDeps,
  type TestReport,
  FORBIDDEN_MESSAGE_KEY,
  NO_CREDIT_MESSAGE_KEY,
  REJECTED_MESSAGE_KEY,
  classifyLlmCheck,
  parsePriceInput,
  type LlmKeyCheck,
  type ModelSuggestions,
  type PriceInput,
  type PriceRow,
  type PriceSaveResult,
  type PricesPort,
} from "../../../src/ui/prefs/preferencesPane";

/**
 * `P1-T44` — the preference pane's logic, markup and controller, in plain Node.
 *
 * Layer 1 (`docs/13` §2.1): no Zotero, no network, no bundle read. The three
 * shipped files are read **off disk** — `addon/content/preferences.xhtml`,
 * `addon/content/preferences.js` and `addon/locale/en-US/research-helper-mainWindow.ftl`
 * — for the same reason `searchDialog.test.ts` reads the search window's: the
 * controller is a classic chrome script with no exports and `tsconfig.json`
 * excludes `addon/`, so evaluating the shipped bytes is the only way to assert
 * anything about them.
 *
 * **This file is not in `P1-T44`'s `Files` list, and that is reported with the
 * card.** The card's test file is `test/integration/preferences.spec.ts`, which
 * needs a Zotero launch per run; the nine `docs/09` §1.9 rules this pane ships
 * include a digest, a paste normalisation and a twelve-row outcome table whose
 * mutations a sub-second test can catch and a three-minute one cannot be run
 * for. `plan/README.md` §6 ("tests ship with the task") and `P1-T20`'s
 * precedent — `searchDialog.test.ts` was likewise added outside its card's
 * list — are the grounds.
 *
 * ## Synthetic values only
 *
 * Every key below is `rhsyn-…` with random hex: key-shaped, obviously fake,
 * never a real credential. The digest is asserted against these values and
 * against nothing else, which is the card's own instruction.
 */

/* ---------------------------------------------------------------- fixtures */

const here = fileURLToPath(import.meta.url);
const root = resolve(dirname(here), "../../..");
const XHTML = readFileSync(
  resolve(root, "addon/content/preferences.xhtml"),
  "utf8",
);
const SCRIPT = readFileSync(
  resolve(root, "addon/content/preferences.js"),
  "utf8",
);
const FTL = readFileSync(
  resolve(root, "addon/locale/en-US/research-helper-mainWindow.ftl"),
  "utf8",
);
const DOC09 = readFileSync(
  resolve(root, "docs/09-security-privacy-and-api-keys.md"),
  "utf8",
);

/** The shipped script with its comments removed, so greps hit code only. */
const SCRIPT_CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);
/** The markup with its comments removed, for the same reason. */
const XHTML_CODE = XHTML.replace(/<!--[\s\S]*?-->/g, "");

function syntheticKey(length = 36): string {
  const alphabet = "0123456789abcdef";
  let hex = "";
  for (let i = 0; i < length; i += 1) {
    hex += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `rhsyn-${hex}`.slice(0, length);
}

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HttpResponse {
  const lower = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status,
    url: "https://example.invalid/",
    body,
    rawHeaders: Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n"),
    header: (name) => lower.get(name.toLowerCase()),
  };
}

/** An in-memory `SecretStore`, so the host can be driven without a keychain. */
function memoryStore(): SecretStore & {
  readonly values: Map<SecretId, string>;
} {
  const values = new Map<SecretId, string>();
  return {
    backend: "os-keychain",
    unattended: true,
    values,
    get: (id) => Promise.resolve(values.get(id)),
    set: (id, value) => {
      values.set(id, value);
      return Promise.resolve();
    },
    clear: (id) => {
      values.delete(id);
      return Promise.resolve();
    },
    has: (id) => Promise.resolve(values.has(id)),
    listStoredIds: () => Promise.resolve([...values.keys()]),
    clearAll: () => {
      const cleared = values.size;
      values.clear();
      return Promise.resolve(cleared);
    },
  };
}

/** A sink that keeps every line, so the negative assertions can read them. */
function recordingSink(): LogSink & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (line) => {
      lines.push(line);
    },
    reportError: (line) => {
      lines.push(`ERROR ${line}`);
    },
  };
}

interface HostHarness {
  readonly store: ReturnType<typeof memoryStore>;
  readonly requests: HttpRequest[];
  readonly sink: ReturnType<typeof recordingSink>;
  readonly clock: ReturnType<typeof createManualClock>;
  readonly host: ReturnType<typeof createPreferencesHost>;
  /** The `<provider>.baseUrl` rows the host wrote, as `src/prefs` would hold them. */
  readonly baseUrls: Map<ProviderId, string>;
  /** Every `setBaseUrl` write the port received, in order. */
  readonly baseUrlWrites: [ProviderId, string][];
}

function hostHarness(
  respond: (request: HttpRequest, attempt: number) => Promise<HttpResponse>,
  options: {
    readonly secrets?: SecretStore | undefined;
    backend?: string;
    activeProvider?: string;
    hasPluginData?: () => Promise<boolean>;
    /** P3-T14's ports, passed through as given. */
    ports?: Pick<
      PreferencesHostDeps,
      "validateLlm" | "validation" | "modelSuggestions" | "prices"
    >;
  } = {},
): HostHarness {
  const store = memoryStore();
  const requests: HttpRequest[] = [];
  const sink = recordingSink();
  const clock = createManualClock(1_760_000_000_000);
  const baseUrls = new Map<ProviderId, string>();
  const baseUrlWrites: [ProviderId, string][] = [];
  const host = createPreferencesHost({
    secrets: "secrets" in options ? options.secrets : store,
    request: (request) => {
      requests.push(request);
      return respond(request, requests.length);
    },
    getBackendPref: () => options.backend ?? OS_KEYSTORE_PREF_VALUE,
    providerPrefs: {
      getActiveProvider: () => options.activeProvider ?? "openrouter",
      getBaseUrl: (provider) => baseUrls.get(provider) ?? "",
      setBaseUrl: (provider, value) => {
        baseUrlWrites.push([provider, value]);
        baseUrls.set(provider, value);
      },
    },
    ...(options.hasPluginData !== undefined && {
      hasPluginData: options.hasPluginData,
    }),
    ...options.ports,
    clock,
    logger: createLogger({ sink, clock, level: "debug" }),
  });
  return { store, requests, sink, clock, host, baseUrls, baseUrlWrites };
}

/* ---------------------------------------------------- 1. the registration */

describe("P1-T44 — registration", () => {
  it("registers a fixed pane id, the fragment and the controller, relative to the plugin root", () => {
    const options = preferencePaneOptions(
      "research-helper@suppakoko.github.io",
    );
    expect(options).toEqual({
      pluginID: "research-helper@suppakoko.github.io",
      id: PREFERENCES_PANE_ID,
      src: PREFERENCES_PANE_SRC,
      scripts: [PREFERENCES_PANE_SCRIPT],
    });
    // `defaultXUL` is not a caller option (docs/01 §7.3, P0-T07).
    expect("defaultXUL" in options).toBe(false);
    // No raw-string label: there is no l10nID, so Zotero's manifest name is used.
    expect("label" in options).toBe(false);
  });

  it("names files that exist and ship", () => {
    expect(() =>
      readFileSync(resolve(root, "addon", PREFERENCES_PANE_SRC)),
    ).not.toThrow();
    expect(() =>
      readFileSync(resolve(root, "addon", PREFERENCES_PANE_SCRIPT)),
    ).not.toThrow();
    const scaffold = readFileSync(
      resolve(root, "zotero-plugin.config.ts"),
      "utf8",
    );
    // Both extensions are already in P0-T34's explicit asset list.
    expect(scaffold).toMatch(
      /assets:\s*\["addon\/\*\*\/\*\.\{[^}]*xhtml[^}]*\}"\]/,
    );
    expect(scaffold).toMatch(
      /assets:\s*\["addon\/\*\*\/\*\.\{[^}]*\bjs\b[^}]*\}"\]/,
    );
  });

  it("holds the two source credentials and the four LLM ones, and refuses every other id (P3-T04)", () => {
    expect(SOURCE_CREDENTIALS.map((entry) => entry.id)).toEqual([
      "source.ncbi",
      "source.semanticscholar",
    ]);
    expect(LLM_CREDENTIALS.map((entry) => [entry.id, entry.provider])).toEqual([
      ["llm.openrouter", "openrouter"],
      ["llm.openai", "openai"],
      ["llm.gemini", "gemini"],
      ["llm.anthropic", "anthropic"],
    ]);
    // In docs/07 §8.5's llmProvider value order, so the menulist and the
    // blocks follow the schema.
    expect(LLM_CREDENTIALS.map((entry) => entry.provider)).toEqual(
      PREFS.llmProvider.values,
    );
    expect(PANE_CREDENTIALS).toEqual([
      ...SOURCE_CREDENTIALS,
      ...LLM_CREDENTIALS,
    ]);
    expect(new Set(PANE_CREDENTIALS.map((c) => c.elementPrefix)).size).toBe(6);
    // docs/08 §7.3 fixes the OpenRouter prefix itself.
    expect(LLM_CREDENTIALS[0]?.elementPrefix).toBe("rh-or");
    for (const id of SECRET_IDS) {
      expect(isPaneCredential(id), id).toBe(id !== "tts.gemini");
      // P3-T14: every block's key can be tested; tts.gemini has no block.
      expect(isTestableCredential(id), id).toBe(id !== "tts.gemini");
    }
    expect(isPaneCredential("not-an-id")).toBe(false);
  });
});

/* -------------------------------------------- 2. rule 7: paste normalisation */

describe("P1-T44 — rule 7, normalizeKeyInput", () => {
  it("trims whitespace and strips a leading Bearer scheme, case-insensitively", () => {
    const key = syntheticKey();
    expect(normalizeKeyInput(`  ${key}\n`)).toBe(key);
    expect(normalizeKeyInput(`Bearer ${key}`)).toBe(key);
    expect(normalizeKeyInput(`  bearer   ${key}  `)).toBe(key);
    expect(normalizeKeyInput(`BEARER\t${key}`)).toBe(key);
  });

  it("leaves a key alone when the scheme word is not at the start or has no space", () => {
    expect(normalizeKeyInput("Bearerabc")).toBe("Bearerabc");
    expect(normalizeKeyInput("x Bearer y")).toBe("x Bearer y");
    expect(normalizeKeyInput("")).toBe("");
    expect(normalizeKeyInput("   ")).toBe("");
  });
});

/* ----------------------------------------------------- 3. rule 2: the digest */

describe("P1-T44 — rule 2, keyDigest", () => {
  it("shows the first three and last four characters of a synthetic key and nothing else", () => {
    const key = syntheticKey(36);
    const digest = keyDigest(key);
    expect(digest).toBe(`${key.slice(0, 3)}…••••••••${key.slice(-4)}`);
    // Seven characters of the key, and no eighth.
    const shown = digest.replaceAll("•", "").replaceAll("…", "");
    expect(shown).toHaveLength(7);
    expect(key.includes(digest)).toBe(false);
    expect(digest.includes(key.slice(3, -4))).toBe(false);
  });

  it("shows only the mask for a key too short for a digest to be a digest", () => {
    const short = syntheticKey(MIN_DIGEST_KEY_LENGTH - 1);
    const digest = keyDigest(short);
    expect(digest).toBe("••••••••");
    for (const character of short) {
      if (character !== "•") expect(digest.includes(character)).toBe(false);
    }
    expect(keyDigest(syntheticKey(MIN_DIGEST_KEY_LENGTH))).toMatch(/^.{3}…/);
  });
});

/* ------------------------------------------------------ 4. rule 3: the badge */

describe("P1-T44 — rule 3, backendBadge", () => {
  it("uses docs/07 §8.5's spellings of the tier-1 and tier-2 preference values", () => {
    expect(PREFS.secretBackend.values).toContain(OS_KEYSTORE_PREF_VALUE);
    expect(OS_KEYSTORE_PREF_VALUE).toBe("oskeystore");
    expect(PREFS.secretBackend.values).toContain(SESSION_PREF_VALUE);
    expect(SESSION_PREF_VALUE).toBe("session");
  });

  it("names the operating-system store on Windows and macOS, and allows storing", () => {
    expect(backendBadge("oskeystore", "win")).toEqual({
      state: "windows",
      messageId: PREFERENCES_L10N.backendWindows,
      warning: false,
      canStore: true,
      osStore: true,
    });
    expect(backendBadge("oskeystore", "mac")).toEqual({
      state: "mac",
      messageId: PREFERENCES_L10N.backendMac,
      warning: false,
      canStore: true,
      osStore: true,
    });
  });

  it("does not claim 'System keyring' on Linux, because the probe cannot tell it from NSSKeyStore (P1-T41)", () => {
    const badge = backendBadge("oskeystore", "linux");
    expect(badge.state).toBe("indeterminate");
    expect(badge.warning).toBe(true);
    expect(badge.canStore).toBe(true);
    expect(badge.osStore).toBe(false);
    expect(badge.messageId).toBe(PREFERENCES_L10N.backendIndeterminate);
    expect(backendBadge("oskeystore", "other").state).toBe("indeterminate");
  });

  it("paints tier 2 as docs/09 §1.9 item 3's 'Not saved between sessions', warning-coloured, and still lets keys be stored (P3-T04)", () => {
    expect(ftlValue(PREFERENCES_L10N.backendSession)).toBe(
      "Not saved between sessions",
    );
    for (const platform of ["win", "mac", "linux", "other"] as const) {
      expect(backendBadge("session", platform)).toEqual({
        state: "session",
        messageId: PREFERENCES_L10N.backendSession,
        warning: true,
        canStore: true,
        osStore: false,
      });
    }
  });

  it("says plainly that nothing is available, and refuses to store, when no store was recorded", () => {
    for (const value of ["", "passphrase", "garbage", "Session"]) {
      for (const platform of ["win", "mac", "linux", "other"] as const) {
        const badge = backendBadge(value, platform);
        expect(badge).toEqual({
          state: "unavailable",
          messageId: PREFERENCES_L10N.backendUnavailable,
          warning: true,
          canStore: false,
          osStore: false,
        });
      }
    }
  });
});

/* ------------------------------ 4b. docs/09 §1.9 item 8: the restore notice */

describe("P3-T04 — the empty-key-after-restore notice (docs/09 §1.9 item 8)", () => {
  const os = { osStore: true };

  it("shows only when no key is stored, the plugin database holds data and the badge names an OS store", () => {
    expect(
      showRestoreNotice({ anyKeyStored: false, pluginDataPresent: true }, os),
    ).toBe(true);
    // A first start: nothing in the database yet.
    expect(
      showRestoreNotice({ anyKeyStored: false, pluginDataPresent: false }, os),
    ).toBe(false);
    // One key of any SecretId is enough to say this is not a restore.
    expect(
      showRestoreNotice({ anyKeyStored: true, pluginDataPresent: true }, os),
    ).toBe(false);
    // Under any non-OS badge the sentence is not known to be true.
    for (const [pref, platform] of [
      ["oskeystore", "linux"],
      ["session", "win"],
      ["", "win"],
    ] as const) {
      expect(
        showRestoreNotice(
          { anyKeyStored: false, pluginDataPresent: true },
          backendBadge(pref, platform),
        ),
      ).toBe(false);
    }
  });

  it("counts a key with no block of its own: a lone tts.gemini key keeps the notice off", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")), {
      hasPluginData: () => Promise.resolve(true),
    });
    let state = await h.host.readState();
    expect(state.anyKeyStored).toBe(false);
    expect(showRestoreNotice(state, os)).toBe(true);
    await h.store.set("tts.gemini", syntheticKey());
    state = await h.host.readState();
    expect(state.credentials.every((c) => !c.present)).toBe(true);
    expect(state.anyKeyStored).toBe(true);
    expect(showRestoreNotice(state, os)).toBe(false);
  });

  it("carries docs/09 §1.9 item 8's sentence word for word", () => {
    expect(ftlValue(PREFERENCES_L10N.restoreNote)).toContain(
      "API keys are stored in this computer's credential store and do not travel with your Zotero data folder.",
    );
  });
});

/* ------------------------------------- 4c. docs/03 §14.4: base-URL override */

describe("P3-T04 — checkBaseUrlInput refuses rather than normalizes (docs/03 §14.4, docs/07 §8.5)", () => {
  it("rejects the card's two bad values and accepts its good one, unchanged", () => {
    expect(checkBaseUrlInput("http://proxy.example/v1")).toEqual({
      ok: false,
      reason: "not-https",
    });
    expect(checkBaseUrlInput("https://proxy.example/v1/")).toEqual({
      ok: false,
      reason: "trailing-slash",
    });
    expect(checkBaseUrlInput("https://proxy.example/v1")).toEqual({
      ok: true,
      value: "https://proxy.example/v1",
    });
  });

  it("accepts empty (the documented base URL) and every documented default", () => {
    expect(checkBaseUrlInput("")).toEqual({ ok: true, value: "" });
    expect(checkBaseUrlInput("   ")).toEqual({ ok: true, value: "" });
    for (const url of Object.values(DEFAULT_BASE_URLS)) {
      expect(checkBaseUrlInput(url)).toEqual({ ok: true, value: url });
    }
    expect(checkBaseUrlInput("  https://gw.example:8443/llm  ")).toEqual({
      ok: true,
      value: "https://gw.example:8443/llm",
    });
  });

  it("does not add a scheme, does not strip a slash, and refuses credentials, queries and fragments", () => {
    for (const [raw, reason] of [
      ["proxy.example/v1", "not-https"],
      ["//proxy.example/v1", "not-https"],
      ["ftp://proxy.example/v1", "not-https"],
      ["https:proxy.example/v1", "not-https"],
      ["https://", "invalid"],
      ["https://proxy.example/", "trailing-slash"],
      ["https://proxy.example/v1//", "trailing-slash"],
      ["https://user:pw@proxy.example/v1", "invalid"],
      ["https://user@proxy.example/v1", "invalid"],
      ["https://proxy.example/v1?key=x", "invalid"],
      ["https://proxy.example/v1?", "invalid"],
      ["https://proxy.example/v1#frag", "invalid"],
      ["https://proxy example/v1", "invalid"],
    ] as const) {
      expect(checkBaseUrlInput(raw), raw).toEqual({ ok: false, reason });
    }
  });
});

/* ------------------------------------------- 5. rule 5: the two Test requests */

describe("P1-T44 — rule 5, the docs/09 §2.3 test requests", () => {
  it("builds the NCBI esummary call on the fixed public PMID with the maintainer identity and the key as api_key", () => {
    const key = syntheticKey();
    const request = ncbiTestRequest(key);
    const url = new URL(request.url);
    expect(request.method).toBe("GET");
    expect(`${url.origin}${url.pathname}`).toBe(NCBI_TEST_URL);
    expect(url.host).toBe(NCBI_EUTILS_HOST);
    expect(url.searchParams.get("db")).toBe("pubmed");
    expect(url.searchParams.get("id")).toBe(NCBI_TEST_PMID);
    expect(url.searchParams.get("retmode")).toBe("json");
    expect(url.searchParams.get("tool")).toBe(TOOL_NAME);
    expect(url.searchParams.get("email")).toBe(MAINTAINER_EMAIL);
    expect(url.searchParams.get("api_key")).toBe(key);
    expect(request.headers?.["x-api-key"]).toBeUndefined();
    expect(request.timeoutMs).toBeGreaterThan(0);
  });

  it("builds the Semantic Scholar graph call on the fixed public DOI with fields=paperId and the key in x-api-key", () => {
    const key = syntheticKey(40);
    const request = semanticScholarTestRequest(key);
    const url = new URL(request.url);
    expect(request.method).toBe("GET");
    expect(`${url.origin}${url.pathname}`).toBe(SEMANTIC_SCHOLAR_TEST_URL);
    expect(url.pathname).toMatch(/^\/graph\/v1\/paper\/DOI:/);
    expect(url.searchParams.get("fields")).toBe("paperId");
    expect(request.headers?.["x-api-key"]).toBe(key);
    // The key never goes in the Semantic Scholar URL.
    expect(request.url.includes(key)).toBe(false);
  });
});

/* ---------------------------------------------- 6. rule 5: the outcome table */

describe("P1-T44 — rule 5, docs/09 §2.3's outcome table", () => {
  it("NCBI: X-Ratelimit-Limit 10 is ok; 3, absent, blank are inconclusive; never rejected", () => {
    expect(
      classifyNcbiResponse(response(200, "{}", { "X-Ratelimit-Limit": "10" })),
    ).toEqual({ outcome: "ok" });
    expect(
      classifyNcbiResponse(response(200, "{}", { "x-ratelimit-limit": "3" })),
    ).toEqual({ outcome: "inconclusive", reason: "unkeyed-budget" });
    expect(classifyNcbiResponse(response(200, "{}"))).toEqual({
      outcome: "inconclusive",
      reason: "no-rate-limit-header",
    });
    expect(
      classifyNcbiResponse(response(200, "{}", { "X-Ratelimit-Limit": " " })),
    ).toEqual({ outcome: "inconclusive", reason: "no-rate-limit-header" });
  });

  it("NCBI: a body error is a query fact, not a credential fact, even with the keyed header", () => {
    expect(
      classifyNcbiResponse(
        response(200, '{"esearchresult":{"ERROR":"bad"}}', {
          "X-Ratelimit-Limit": "10",
        }),
      ),
    ).toEqual({ outcome: "inconclusive", reason: "body-error" });
    expect(
      classifyNcbiResponse(
        response(200, '{"error":"API key invalid"}', {
          "X-Ratelimit-Limit": "10",
        }),
      ),
    ).toEqual({ outcome: "inconclusive", reason: "body-error" });
    // Not JSON at all: judged by the header alone.
    expect(
      classifyNcbiResponse(
        response(200, "<xml/>", { "X-Ratelimit-Limit": "10" }),
      ),
    ).toEqual({ outcome: "ok" });
  });

  it("Semantic Scholar: a paperId is ok, anything else on a 200 is inconclusive", () => {
    expect(
      classifySemanticScholarResponse(response(200, '{"paperId":"abc"}')),
    ).toEqual({ outcome: "ok" });
    expect(classifySemanticScholarResponse(response(200, "{}"))).toEqual({
      outcome: "inconclusive",
      reason: "no-paper-id",
    });
    expect(classifySemanticScholarResponse(response(200, "nope"))).toEqual({
      outcome: "inconclusive",
      reason: "no-paper-id",
    });
  });

  it("failures: 429 is inconclusive for both — the one place the general '429 passes' rule must not apply", () => {
    const rateLimited = new RateLimitError(429, undefined, "host");
    expect(classifyFailure("source.ncbi", rateLimited)).toEqual({
      outcome: "inconclusive",
      reason: "rate-limited",
    });
    expect(classifyFailure("source.semanticscholar", rateLimited)).toEqual({
      outcome: "inconclusive",
      reason: "rate-limited",
    });
  });

  it("failures: Semantic Scholar 401 → rejected and 403 → forbidden; NCBI never", () => {
    const auth = new AuthenticationError(401, "HTTP 401", {});
    const forbidden = new AuthorizationError(403, "HTTP 403", {});
    expect(classifyFailure("source.semanticscholar", auth)).toEqual({
      outcome: "rejected",
    });
    expect(classifyFailure("source.semanticscholar", forbidden)).toEqual({
      outcome: "forbidden",
    });
    expect(classifyFailure("source.ncbi", auth)).toEqual({
      outcome: "inconclusive",
      reason: "request-failed",
    });
    expect(classifyFailure("source.ncbi", forbidden)).toEqual({
      outcome: "inconclusive",
      reason: "request-failed",
    });
  });

  it("failures: server errors, network failures and unknown throws are inconclusive", () => {
    // P3-T14: an answered failure is `request-failed` (persisted); one with
    // no HTTP status is `no-answer`, which leaves the stored status alone.
    const cases: [unknown, string][] = [
      [new UpstreamServerError(503, "HTTP 503", {}), "request-failed"],
      [new NetworkError("boom", {}), "no-answer"],
      [new TimeoutError(15_000, "https://example.invalid/"), "no-answer"],
      [new Error("anything"), "no-answer"],
      ["a string", "no-answer"],
      [undefined, "no-answer"],
    ];
    for (const [error, reason] of cases) {
      for (const id of ["source.ncbi", "source.semanticscholar"] as const) {
        expect(classifyFailure(id, error)).toEqual({
          outcome: "inconclusive",
          reason,
        });
      }
    }
  });
});

/* --------------------------------------------------------------- 7. the host */

describe("P1-T44 — the host over an in-memory store", () => {
  it("stores a normalised key, returns its digest, shows presence, replaces and clears", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    const first = syntheticKey();
    const stored = await h.host.storeKey("source.ncbi", `Bearer ${first} `);
    expect(stored).toEqual({ stored: true, digest: keyDigest(first) });
    expect(h.store.values.get("source.ncbi")).toBe(first);

    let state = await h.host.readState();
    expect(state.storeAvailable).toBe(true);
    expect(state.backendPref).toBe(OS_KEYSTORE_PREF_VALUE);
    expect(state.credentials).toEqual(
      PANE_CREDENTIALS.map(({ id }) => ({
        id,
        present: id === "source.ncbi",
        lastTest: undefined,
      })),
    );

    const second = syntheticKey();
    const replaced = await h.host.storeKey("source.ncbi", second);
    expect(replaced).toEqual({ stored: true, digest: keyDigest(second) });
    expect(h.store.values.get("source.ncbi")).toBe(second);

    expect(await h.host.clearKey("source.ncbi")).toBe(true);
    expect(await h.host.clearKey("source.ncbi")).toBe(false);
    state = await h.host.readState();
    expect(state.credentials[0]?.present).toBe(false);
  });

  it("refuses an empty field and refuses every write when there is no store", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    expect(await h.host.storeKey("source.ncbi", "  Bearer   ")).toEqual({
      stored: false,
      reason: "empty",
    });
    expect(h.store.values.size).toBe(0);

    const none = hostHarness(() => Promise.reject(new Error("unused")), {
      secrets: undefined,
      backend: "",
    });
    expect(await none.host.storeKey("source.ncbi", syntheticKey())).toEqual({
      stored: false,
      reason: "unavailable",
    });
    expect(await none.host.clearKey("source.ncbi")).toBe(false);
    expect(await none.host.clearAllKeys()).toBe(0);
    expect(await none.host.testKey("source.ncbi")).toEqual({
      kind: "unavailable",
    });
    const state = await none.host.readState();
    expect(state.storeAvailable).toBe(false);
    expect(state.credentials.every((c) => !c.present)).toBe(true);
  });

  it("rejects an id the pane has no block for, before touching the store", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    await expect(h.host.storeKey("tts.gemini", syntheticKey())).rejects.toThrow(
      RangeError,
    );
    await expect(h.host.testKey("nonsense")).rejects.toThrow(RangeError);
    await expect(h.host.clearKey("tts.gemini")).rejects.toThrow(RangeError);
    await expect(
      h.host.setBaseUrl("mistral", "https://proxy.example/v1"),
    ).rejects.toThrow(RangeError);
    expect(h.store.values.size).toBe(0);
    expect(h.baseUrlWrites).toEqual([]);
  });

  it("Remove all clears every stored SecretId through the port's one sweep, not only the pane's six, and reports the count", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    let sweeps = 0;
    const sweep = h.store.clearAll.bind(h.store);
    (h.store as { clearAll: () => Promise<number> }).clearAll = () => {
      sweeps += 1;
      return sweep();
    };
    await h.store.set("tts.gemini", syntheticKey());
    await h.host.storeKey("llm.openai", syntheticKey());
    await h.host.storeKey("source.ncbi", syntheticKey());
    await h.host.storeKey("source.semanticscholar", syntheticKey(40));
    expect(await h.host.clearAllKeys()).toBe(4);
    expect(sweeps).toBe(1);
    expect(h.store.values.size).toBe(0);
    expect(await h.host.clearAllKeys()).toBe(0);
  });

  for (const { id, provider } of LLM_CREDENTIALS) {
    it(`${provider}: stores a normalised synthetic key under ${id}, masks it, shows presence and clears it (P3-T04)`, async () => {
      const h = hostHarness(() => Promise.reject(new Error("unused")));
      const key = `sk-rhsyn-${syntheticKey(40)}`;
      expect(await h.host.storeKey(id, `  Bearer ${key}\n`)).toEqual({
        stored: true,
        digest: keyDigest(key),
      });
      expect(h.store.values.get(id)).toBe(key);
      expect([...h.store.values.keys()]).toEqual([id]);
      let state = await h.host.readState();
      expect(
        state.credentials.filter((c) => c.present).map((c) => c.id),
      ).toEqual([id]);
      expect(await h.host.clearKey(id)).toBe(true);
      expect(h.store.values.size).toBe(0);
      state = await h.host.readState();
      expect(state.credentials.every((c) => !c.present)).toBe(true);
      // Nothing about the key reached a log line.
      const lines = h.sink.lines.join("\n");
      expect(lines.includes(key)).toBe(false);
      expect(lines.includes(keyDigest(key))).toBe(false);
      expect(lines.includes(key.slice(-4))).toBe(false);
    });
  }

  it("Test of an LLM key goes to its own adapter through validateLlm: the host never reads it and sends no source request (P3-T14)", async () => {
    const asked: ProviderId[] = [];
    const h = hostHarness(() => Promise.reject(new Error("unused")), {
      ports: {
        validateLlm: (provider) => {
          asked.push(provider);
          return Promise.resolve({
            ok: true,
            messageKey: PREFERENCES_L10N.testOk,
            httpStatus: 200,
            models: [{ id: `${provider}-model-a` }],
          });
        },
      },
    });
    let reads = 0;
    const get = h.store.get.bind(h.store);
    (h.store as { get: SecretStore["get"] }).get = (id) => {
      reads += 1;
      return get(id);
    };
    for (const { id, provider } of LLM_CREDENTIALS) {
      // No key stored: absent, and the adapter is not asked.
      expect(await h.host.testKey(id)).toEqual({ kind: "absent" });
      await h.host.storeKey(id, syntheticKey());
      expect(await h.host.testKey(id)).toEqual({
        kind: "tested",
        outcome: "ok",
        checkedAt: new Date(h.clock.now()).toISOString(),
        models: [`${provider}-model-a`],
      });
    }
    expect(asked).toEqual(LLM_CREDENTIALS.map(({ provider }) => provider));
    expect(reads).toBe(0);
    expect(h.requests).toEqual([]);
  });

  it("readState reports the active provider, every stored base URL and whether the plugin database holds data", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")), {
      activeProvider: "gemini",
      hasPluginData: () => Promise.resolve(true),
    });
    h.baseUrls.set("openai", "https://gw.example/v1");
    const state = await h.host.readState();
    expect(state.activeProvider).toBe("gemini");
    expect(state.providers).toEqual([
      { provider: "openrouter", baseUrl: "" },
      { provider: "openai", baseUrl: "https://gw.example/v1" },
      { provider: "gemini", baseUrl: "" },
      { provider: "anthropic", baseUrl: "" },
    ]);
    expect(state.pluginDataPresent).toBe(true);

    // An llmProvider value the pane has no block for reads as the §8.5 default;
    // no database probe, or a failing one, reads as "no data".
    const odd = hostHarness(() => Promise.reject(new Error("unused")), {
      activeProvider: "mistral",
    });
    const oddState = await odd.host.readState();
    expect(oddState.activeProvider).toBe("openrouter");
    expect(oddState.pluginDataPresent).toBe(false);
    const failing = hostHarness(() => Promise.reject(new Error("unused")), {
      hasPluginData: () => Promise.reject(new Error("db closed")),
    });
    expect((await failing.host.readState()).pluginDataPresent).toBe(false);
  });

  it("setBaseUrl writes only a valid value, refuses the card's two bad ones without writing, and never logs the value", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    const good = "https://proxy.example/v1";
    expect(await h.host.setBaseUrl("openai", good)).toEqual<BaseUrlResult>({
      stored: true,
      cleared: false,
    });
    expect(h.baseUrls.get("openai")).toBe(good);
    expect((await h.host.readState()).providers[1]).toEqual({
      provider: "openai",
      baseUrl: good,
    });
    for (const [bad, reason] of [
      ["http://proxy.example/v1", "not-https"],
      ["https://proxy.example/v1/", "trailing-slash"],
      ["https://secret-user:secret-pw@proxy.example/v1", "invalid"],
    ] as const) {
      expect(await h.host.setBaseUrl("openai", bad)).toEqual<BaseUrlResult>({
        stored: false,
        reason,
      });
      // The previous value is kept.
      expect(h.baseUrls.get("openai")).toBe(good);
    }
    expect(await h.host.setBaseUrl("openai", "  ")).toEqual<BaseUrlResult>({
      stored: true,
      cleared: true,
    });
    expect(h.baseUrls.get("openai")).toBe("");
    expect(h.baseUrlWrites).toEqual([
      ["openai", good],
      ["openai", ""],
    ]);
    const lines = h.sink.lines.join("\n");
    expect(lines).not.toContain("proxy.example");
    expect(lines).not.toContain("secret-pw");
    expect(lines).toContain("base URL refused");
  });

  it("Test: absent key reports absent without a request", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    expect(await h.host.testKey("source.ncbi")).toEqual({ kind: "absent" });
    expect(h.requests).toEqual([]);
  });

  it("Test: NCBI success is ok, stamped from the clock, and remembered for the session", async () => {
    const h = hostHarness(() =>
      Promise.resolve(response(200, "{}", { "X-Ratelimit-Limit": "10" })),
    );
    await h.host.storeKey("source.ncbi", syntheticKey());
    const report = await h.host.testKey("source.ncbi");
    expect(report).toEqual({
      kind: "tested",
      outcome: "ok",
      checkedAt: new Date(h.clock.now()).toISOString(),
    });
    expect(h.requests).toHaveLength(1);
    const state = await h.host.readState();
    expect(state.credentials[0]?.lastTest).toEqual(report);
    // A replaced key forgets the old key's verdict.
    await h.host.storeKey("source.ncbi", syntheticKey());
    expect((await h.host.readState()).credentials[0]?.lastTest).toBeUndefined();
  });

  it("Test: Semantic Scholar retries once after a 429 and then records inconclusive", async () => {
    const h = hostHarness(() =>
      Promise.reject(
        new RateLimitError(429, undefined, "api.semanticscholar.org"),
      ),
    );
    await h.host.storeKey("source.semanticscholar", syntheticKey(40));
    const pending = h.host.testKey("source.semanticscholar");
    // The retry waits on the clock: let the first attempt reject and the sleep
    // register, then advance so it resolves.
    while (h.clock.pending === 0) await flush();
    h.clock.advance(SEMANTIC_SCHOLAR_RETRY_DELAY_MS);
    const report = await pending;
    expect(h.requests).toHaveLength(2);
    expect(report).toMatchObject({
      kind: "tested",
      outcome: "inconclusive",
      reason: "rate-limited",
    });
  });

  it("Test: Semantic Scholar does not retry a 401, and NCBI never retries a 429", async () => {
    const s2 = hostHarness(() =>
      Promise.reject(new AuthenticationError(401, "HTTP 401", {})),
    );
    await s2.host.storeKey("source.semanticscholar", syntheticKey(40));
    expect(await s2.host.testKey("source.semanticscholar")).toMatchObject({
      outcome: "rejected",
    });
    expect(s2.requests).toHaveLength(1);

    const ncbi = hostHarness(() =>
      Promise.reject(new RateLimitError(429, undefined, "eutils")),
    );
    await ncbi.host.storeKey("source.ncbi", syntheticKey());
    expect(await ncbi.host.testKey("source.ncbi")).toMatchObject({
      outcome: "inconclusive",
      reason: "rate-limited",
    });
    expect(ncbi.requests).toHaveLength(1);
  });
});

/* ------------------------------------ 8. the negative: nothing carries the key */

describe("P1-T44 — the key reaches no log line, no error, no report, on either path", () => {
  async function drive(fail: boolean): Promise<{
    key: string;
    digest: string;
    report: TestReport;
    h: HostHarness;
  }> {
    const key = syntheticKey();
    // Worst case on purpose: the failing transport echoes the whole URL — key
    // included — in its message, and the succeeding one echoes the key in its
    // body. The host must not forward either anywhere.
    const h = hostHarness((request) =>
      fail
        ? Promise.reject(
            new UpstreamServerError(500, `request to ${request.url} failed`, {
              url: request.url,
            }),
          )
        : Promise.resolve(
            response(200, JSON.stringify({ echo: key }), {
              "X-Ratelimit-Limit": "10",
            }),
          ),
    );
    const stored = await h.host.storeKey("source.ncbi", key);
    if (!stored.stored) throw new Error("fixture: store refused");
    const report = await h.host.testKey("source.ncbi");
    return { key, digest: stored.digest, report, h };
  }

  for (const fail of [false, true]) {
    it(`${fail ? "failing" : "succeeding"} Test call: no log line, no report field, no thrown text contains the key or the digest`, async () => {
      const { key, digest, report, h } = await drive(fail);
      expect(report.kind).toBe("tested");
      expect(h.requests[0]?.url.includes(key)).toBe(true); // it did go out
      const everything = [
        ...h.sink.lines,
        JSON.stringify(report),
        JSON.stringify(await h.host.readState()),
      ].join("\n");
      expect(everything.includes(key)).toBe(false);
      expect(everything.includes(digest)).toBe(false);
      expect(everything.includes(key.slice(-4))).toBe(false);
      // and something *was* logged, so the sweep is not vacuous
      expect(h.sink.lines.length).toBeGreaterThan(0);
    });
  }
});

/* ----------------------------------------------------- 9. the strings on disk */

/** The five paragraphs of docs/09 §1.8's blockquote, emphasis markers dropped. */
function residualRiskParagraphs(): string[] {
  const start = DOC09.indexOf("### 1.8 Residual risk statement");
  expect(start).toBeGreaterThan(-1);
  const quoteStart = DOC09.indexOf("\n>", start);
  const lines = DOC09.slice(quoteStart + 1)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  const quoted: string[] = [];
  for (const line of lines) {
    if (!line.startsWith(">")) break;
    quoted.push(line.replace(/^>\s?/, ""));
  }
  // The first quoted line is the "Residual risk (to be reproduced verbatim
  // …):" heading, which runs straight into paragraph 1 with no blank line.
  const heading = quoted.shift() ?? "";
  expect(heading).toMatch(/^\*\*Residual risk/);
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of quoted) {
    if (line.trim() === "") {
      if (current.length) paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.map((p) => p.replaceAll("**", ""));
}

function ftlValue(id: string): string {
  const match = new RegExp(`^${id} = (.*)$`, "m").exec(FTL);
  expect(
    match,
    `${id} is a single-line message in the en-US bundle`,
  ).not.toBeNull();
  return match![1]!.trim();
}

describe("P1-T44 — rule 4, docs/09 §1.8 verbatim in the bundle", () => {
  it("reproduces all five paragraphs word for word", () => {
    const expected = residualRiskParagraphs();
    expect(expected).toHaveLength(5);
    const ids = [
      PREFERENCES_L10N.risk1,
      PREFERENCES_L10N.risk2,
      PREFERENCES_L10N.risk3,
      PREFERENCES_L10N.risk4,
      PREFERENCES_L10N.risk5,
    ];
    ids.forEach((id, index) => {
      expect(ftlValue(id)).toBe(expected[index]);
    });
    // The sentence about other Zotero plugins is the one the card names.
    expect(ftlValue(PREFERENCES_L10N.risk4)).toContain(
      "including any other Zotero plugin",
    );
  });

  it("declares every pane id on the main-window surface, and the pane uses no other", () => {
    const declared = new Set<string>(MAIN_WINDOW_MESSAGE_IDS);
    for (const id of Object.values(PREFERENCES_L10N)) {
      expect(declared.has(id), `${id} on MAIN_WINDOW_MESSAGE_IDS`).toBe(true);
      expect(FTL.includes(`\n${id} =`), `${id} in the en-US bundle`).toBe(true);
    }
    const inMarkup = [...XHTML_CODE.matchAll(/data-l10n-id="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(inMarkup.length).toBeGreaterThan(0);
    const known = new Set<string>(Object.values(PREFERENCES_L10N));
    for (const id of inMarkup) {
      expect(known.has(id), `${id} in PREFERENCES_L10N`).toBe(true);
    }
  });

  it("uses no message that takes the key or a digest as an argument", () => {
    // The argument map is the enforcement point (keys.ts); here the bundle's
    // own placeables are read, so a `{ $key }` or `{ $digest }` added to a pane
    // string fails even before the typecheck does.
    const block = FTL.slice(FTL.indexOf("research-helper-prefs-storage ="));
    expect(block).not.toMatch(/\{\s*\$(key|digest|secret|value)\b/);
  });
});

/**
 * docs/09 §1.8's tier-2 replacement for a paragraph: the quoted line under its
 * bold label. Paragraph 1's (item 274(a)) and paragraph 4's (item 275(b)).
 */
function tierTwoRiskSentence(paragraph: 1 | 4 = 1): string {
  const label = `> **Tier 2 (session-only), in place of paragraph ${paragraph}:**`;
  const start = DOC09.indexOf(label);
  expect(start).toBeGreaterThan(DOC09.indexOf("### 1.8 Residual risk"));
  expect(start).toBeLessThan(DOC09.indexOf("### 1.9 How the UI"));
  const lines = DOC09.slice(start + label.length)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  const quoted: string[] = [];
  for (const line of lines.slice(1)) {
    if (!line.startsWith(">")) break;
    quoted.push(line.replace(/^>\s?/, "").trim());
  }
  return quoted.join(" ").replaceAll("**", "");
}

describe("item 274(a) — docs/09 §1.8's tier-2 sentence replaces paragraph 1 under the session badge", () => {
  it("ships the sentence word for word, and it says what tier 2 does", () => {
    const sentence = tierTwoRiskSentence();
    expect(ftlValue(PREFERENCES_L10N.risk1Session)).toBe(sentence);
    expect(sentence).toContain("held in memory only");
    expect(sentence).toContain("written nowhere");
    expect(sentence).toContain("gone when Zotero closes");
    // It is not a sixth paragraph of the statement the five-paragraph test reads.
    expect(residualRiskParagraphs()).toHaveLength(5);
    expect(residualRiskParagraphs()).not.toContain(sentence);
  });

  it("riskOpeningMessageId picks it only for the session badge", () => {
    for (const platform of ["win", "mac", "linux", "other"] as const) {
      expect(riskOpeningMessageId(backendBadge("session", platform))).toBe(
        PREFERENCES_L10N.risk1Session,
      );
      for (const pref of ["oskeystore", "", "passphrase", "Session"]) {
        expect(riskOpeningMessageId(backendBadge(pref, platform))).toBe(
          PREFERENCES_L10N.risk1,
        );
      }
    }
  });

  it("the controller's rule is the same rule, and refresh paints it into paragraph 1's element", async () => {
    const h = paneHarness({});
    for (const platform of ["win", "mac", "linux", "other"] as const) {
      for (const pref of ["oskeystore", "", "session", "passphrase"]) {
        expect(h.controller.logic.riskOpening(pref, h.controller)).toBe(
          riskOpeningMessageId(backendBadge(pref, platform)),
        );
      }
    }
    expect(h.controller.l10n["risk1Session"]).toBe(
      PREFERENCES_L10N.risk1Session,
    );
    expect(XHTML_CODE).toMatch(
      /<html:p\s+id="rh-prefs-risk-1"\s+class="rh-hint rh-risk"\s+data-l10n-id="research-helper-prefs-risk-1"/,
    );

    const session = paneHarness({
      host: fakeHost({ backendPref: SESSION_PREF_VALUE }),
    });
    await session.controller.init(session.root);
    expect(session.byId("rh-prefs-risk-1").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk1Session,
    );

    const os = paneHarness({ host: fakeHost({}) });
    await os.controller.init(os.root);
    expect(os.byId("rh-prefs-risk-1").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk1,
    );
    // A session preference with no live store is "unavailable": paragraph 1.
    const noStore = paneHarness({
      host: fakeHost({
        backendPref: SESSION_PREF_VALUE,
        storeAvailable: false,
      }),
    });
    await noStore.controller.init(noStore.root);
    expect(noStore.byId("rh-prefs-risk-1").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk1,
    );
  });
});

describe("item 275(b) — docs/09 §1.8's tier-2 replacement for paragraph 4 under the session badge", () => {
  it("ships the sentence word for word, and it says what tier 2 does not protect", () => {
    const sentence = tierTwoRiskSentence(4);
    expect(sentence).toBe(
      "Even held in memory, the keys are not protected from software running under your own user account: any program you run — including any other Zotero plugin — can read them. Zotero does not isolate plugins from each other.",
    );
    expect(ftlValue(PREFERENCES_L10N.risk4Session)).toBe(sentence);
    expect(sentence).toContain("including any other Zotero plugin");
    // It presumes no encryption, which is the point of the replacement.
    expect(sentence).not.toContain("decrypt");
    expect(sentence).not.toBe(tierTwoRiskSentence(1));
    // It is not a sixth paragraph of the statement the five-paragraph test reads.
    expect(residualRiskParagraphs()).toHaveLength(5);
    expect(residualRiskParagraphs()).not.toContain(sentence);
  });

  it("riskOwnAccountMessageId picks it only for the session badge", () => {
    for (const platform of ["win", "mac", "linux", "other"] as const) {
      expect(riskOwnAccountMessageId(backendBadge("session", platform))).toBe(
        PREFERENCES_L10N.risk4Session,
      );
      for (const pref of ["oskeystore", "", "passphrase", "Session"]) {
        expect(riskOwnAccountMessageId(backendBadge(pref, platform))).toBe(
          PREFERENCES_L10N.risk4,
        );
      }
    }
  });

  it("the controller's rule is the same rule, and refresh paints it into paragraph 4's element", async () => {
    const h = paneHarness({});
    for (const platform of ["win", "mac", "linux", "other"] as const) {
      for (const pref of ["oskeystore", "", "session", "passphrase"]) {
        expect(h.controller.logic.riskOwnAccount(pref, h.controller)).toBe(
          riskOwnAccountMessageId(backendBadge(pref, platform)),
        );
      }
    }
    expect(h.controller.l10n["risk4"]).toBe(PREFERENCES_L10N.risk4);
    expect(h.controller.l10n["risk4Session"]).toBe(
      PREFERENCES_L10N.risk4Session,
    );
    expect(XHTML_CODE).toMatch(
      /<html:p\s+id="rh-prefs-risk-4"\s+class="rh-hint rh-risk"\s+data-l10n-id="research-helper-prefs-risk-4"/,
    );

    const session = paneHarness({
      host: fakeHost({ backendPref: SESSION_PREF_VALUE }),
    });
    await session.controller.init(session.root);
    expect(session.byId("rh-prefs-risk-4").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk4Session,
    );
    // Both swaps happen together under tier 2.
    expect(session.byId("rh-prefs-risk-1").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk1Session,
    );

    const os = paneHarness({ host: fakeHost({}) });
    await os.controller.init(os.root);
    expect(os.byId("rh-prefs-risk-4").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk4,
    );
    // A session preference with no live store is "unavailable": paragraph 4.
    const noStore = paneHarness({
      host: fakeHost({
        backendPref: SESSION_PREF_VALUE,
        storeAvailable: false,
      }),
    });
    await noStore.controller.init(noStore.root);
    expect(noStore.byId("rh-prefs-risk-4").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.risk4,
    );
  });
});

/* ------------------------------------------------------- 10. the markup rules */

describe("P1-T44 — the fragment carries the markup rules", () => {
  const allInputs = [...XHTML_CODE.matchAll(/<html:input\b[^>]*>/g)].map(
    (m) => m[0],
  );
  const keyInputs = allInputs.filter((tag) => /class="rh-key"/.test(tag));

  it("is a fragment: no DOCTYPE, no html wrapper, XUL default namespace, the root id the script waits for", () => {
    expect(XHTML_CODE).not.toMatch(/<!DOCTYPE/i);
    expect(XHTML_CODE).not.toMatch(/<html[\s>]/);
    expect(XHTML_CODE).toMatch(
      /<vbox\s[^>]*xmlns="http:\/\/www\.mozilla\.org\/keymaster\/gatekeeper\/there\.is\.only\.xul"/,
    );
    expect(XHTML_CODE).toMatch(new RegExp(`id="${PREFERENCES_ROOT_ID}"`));
    expect(XHTML_CODE).toMatch(
      /<html:link rel="localization" href="__addonRef__-mainWindow\.ftl"/,
    );
    // No inline handler: the script runs in an isolated sandbox.
    expect(XHTML_CODE).not.toMatch(/\son[a-z]+="/);
    expect(XHTML_CODE).not.toMatch(/<script/);
    // No remote resource: the only http(s) in a `src`/`href` is the Semantic
    // Scholar request link, which the script opens through Zotero.launchURL.
    // (The two `xmlns` namespace URIs are identifiers, not resources.)
    const resourceUrls = [
      ...XHTML_CODE.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g),
    ].map((m) => m[1]!);
    expect(resourceUrls).toEqual([
      "https://www.semanticscholar.org/product/api#api-key-form",
    ]);
  });

  it("rule 1 and 9: every key field is a password input with no preference attribute", () => {
    expect(keyInputs).toHaveLength(PANE_CREDENTIALS.length);
    for (const { elementPrefix } of PANE_CREDENTIALS) {
      const input = keyInputs.find((tag) =>
        tag.includes(`id="${elementPrefix}-key"`),
      );
      expect(input, `${elementPrefix}-key is a key input`).toBeDefined();
      expect(input).toMatch(/type="password"/);
      expect(input).not.toMatch(/\bpreference=/);
      expect(input).toMatch(/autocomplete="off"/);
    }
    // Every password input is a key field; nothing else is masked.
    expect(allInputs.filter((tag) => /type="password"/.test(tag))).toEqual(
      keyInputs,
    );
  });

  it("every preference= names a key in src/prefs/keys.ts, fully qualified, and no key or base-URL input carries one (P3-T04)", () => {
    const bound = [
      ...XHTML_CODE.matchAll(/<([\w:]+)\b([^>]*?)\bpreference="([^"]+)"/g),
    ].map((m) => ({ tag: m[0], name: m[3]! }));
    const qualified = new Set<string>(
      Object.values(PREF_KEYS).map((key) => qualifiedPrefKey(key)),
    );
    for (const { name } of bound) {
      expect(qualified.has(name), `${name} is a PREF_KEYS row`).toBe(true);
    }
    // Exactly the non-secret rows docs/08 §7.3 binds, and no others.
    expect(bound.map((b) => b.name).sort()).toEqual(
      [
        PREF_KEYS.llmProvider,
        PREF_KEYS.openrouterModel,
        PREF_KEYS.openaiModel,
        PREF_KEYS.geminiModel,
        PREF_KEYS.anthropicModel,
        PREF_KEYS.geminiPaidTier,
      ]
        .map((key) => qualifiedPrefKey(key))
        .sort(),
    );
    for (const { tag } of bound) {
      expect(tag).not.toMatch(/class="rh-key"|type="password"|rh-base-url/);
      expect(tag).not.toMatch(/KeyPresent|keyPresent|secretBackend/);
    }
    // No `*.keyPresent`, `*.baseUrl` or secret row is bound anywhere.
    expect(XHTML_CODE).not.toMatch(/preference="[^"]*(keyPresent|baseUrl)"/);
    for (const def of Object.values(PREFS)) {
      if ((def as { secret?: boolean }).secret === true) {
        expect(XHTML_CODE).not.toContain(qualifiedPrefKey(def.key));
      }
    }
  });

  it("the LLM block: a provider menulist bound to llmProvider, whose literal labels are the never-translated provider names", () => {
    const menu =
      /<menulist\b[^>]*id="rh-provider"[^>]*>([\s\S]*?)<\/menulist>/.exec(
        XHTML_CODE,
      );
    expect(menu, "the provider menulist").not.toBeNull();
    expect(menu![0]).toMatch(
      new RegExp(`preference="${qualifiedPrefKey(PREF_KEYS.llmProvider)}"`),
    );
    const items = [
      ...menu![1]!.matchAll(/<menuitem value="([^"]+)" label="([^"]+)"/g),
    ].map((m) => [m[1]!, m[2]!]);
    expect(items.map(([value]) => value)).toEqual(PREFS.llmProvider.values);
    for (const [value, label] of items) {
      // docs/08 §10.3: provider names are not translated, so the literal must
      // be exactly the en-US (and KO_PRESENT) display name.
      expect(label).toBe(ftlValue(`research-helper-provider-${value}`));
    }
  });

  it("the LLM block: per provider, a model input bound to <provider>.model and an unbound base-URL input whose placeholder is the documented base URL", () => {
    for (const { provider, elementPrefix } of LLM_CREDENTIALS) {
      expect(XHTML_CODE).toMatch(
        new RegExp(`<vbox\\s+id="rh-provider-${provider}"`),
      );
      const model = allInputs.find((tag) =>
        tag.includes(`id="${elementPrefix}-model"`),
      );
      expect(model, `${elementPrefix}-model`).toBeDefined();
      expect(model).toContain(
        `preference="${qualifiedPrefKey(PREF_KEYS[`${provider}Model`])}"`,
      );
      const base = allInputs.find((tag) =>
        tag.includes(`id="${elementPrefix}-base-url"`),
      );
      expect(base, `${elementPrefix}-base-url`).toBeDefined();
      expect(base).not.toMatch(/\bpreference=/);
      expect(base).toContain(`placeholder="${DEFAULT_BASE_URLS[provider]}"`);
      expect(XHTML_CODE).toMatch(
        new RegExp(`id="${elementPrefix}-base-url-status"[^>]*role="status"`),
      );
    }
    // The Gemini block, and only it, carries the paid-tier declaration.
    const checkboxes = [...XHTML_CODE.matchAll(/<checkbox\b[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).toContain(
      `preference="${qualifiedPrefKey(PREF_KEYS.geminiPaidTier)}"`,
    );
    expect(checkboxes[0]).toContain(
      `data-l10n-id="${PREFERENCES_L10N.geminiPaidTier}"`,
    );
    const gemini = /<vbox\s+id="rh-provider-gemini"[\s\S]*?<\/vbox>/.exec(
      XHTML_CODE,
    );
    expect(gemini![0]).toContain('id="rh-gemini-paid-tier"');
    expect(gemini![0]).toContain(PREFERENCES_L10N.geminiPaidTierNote);
    // §8.5: the declaration is off by default and has no pref() line, so the
    // binding reads it as false.
    expect(PREFS.geminiPaidTier.default).toBe(false);
  });

  it("the paid-tier label states it is the user's own declaration about billing", () => {
    const label =
      /research-helper-prefs-gemini-paid-tier =\n\s+\.label = (.*)/.exec(FTL);
    expect(label).not.toBeNull();
    expect(label![1]).toMatch(/^I declare/);
    expect(label![1]).toMatch(/billing-linked/);
    expect(ftlValue(PREFERENCES_L10N.geminiPaidTierNote)).toMatch(
      /your own statement/,
    );
  });

  it("rule 1: a reveal button per field, labelled as hold-to-show, and no sticky toggle", () => {
    for (const { elementPrefix } of PANE_CREDENTIALS) {
      expect(XHTML_CODE).toMatch(
        new RegExp(
          `id="${elementPrefix}-reveal"\\s+data-l10n-id="${PREFERENCES_L10N.reveal}"`,
        ),
      );
    }
    expect(FTL).toMatch(
      new RegExp(`${PREFERENCES_L10N.reveal} =\\n\\s+\\.label = Hold to show`),
    );
    expect(XHTML_CODE).not.toMatch(
      /type="checkbox"[^>]*reveal|reveal[^>]*type="checkbox"/,
    );
  });

  it("rules 3, 5, 6: a badge, a status row and Test / Clear per credential, one Remove all", () => {
    expect(XHTML_CODE).toMatch(/id="rh-prefs-backend"[^>]*role="status"/);
    for (const { elementPrefix } of PANE_CREDENTIALS) {
      expect(XHTML_CODE).toMatch(new RegExp(`id="${elementPrefix}-backend"`));
      expect(XHTML_CODE).toMatch(
        new RegExp(`id="${elementPrefix}-status"[^>]*role="status"`),
      );
      expect(XHTML_CODE).toMatch(
        new RegExp(
          `id="${elementPrefix}-test"\\s+data-l10n-id="${PREFERENCES_L10N.testKey}"`,
        ),
      );
      expect(XHTML_CODE).toMatch(
        new RegExp(
          `id="${elementPrefix}-clear"\\s+data-l10n-id="${PREFERENCES_L10N.clearKey}"`,
        ),
      );
    }
    expect([...XHTML_CODE.matchAll(/id="rh-prefs-remove-all"/g)]).toHaveLength(
      1,
    );
  });

  it("rule 4: the five risk paragraphs are plain always-visible paragraphs, not a disclosure or a link", () => {
    for (const id of [
      PREFERENCES_L10N.risk1,
      PREFERENCES_L10N.risk2,
      PREFERENCES_L10N.risk3,
      PREFERENCES_L10N.risk4,
      PREFERENCES_L10N.risk5,
    ]) {
      const tag = new RegExp(`<html:p[^>]*data-l10n-id="${id}"[^>]*/>`).exec(
        XHTML_CODE,
      );
      expect(tag, `${id} is an <html:p>`).not.toBeNull();
      expect(tag![0]).not.toMatch(/hidden|collapsed/);
    }
    expect(XHTML_CODE).not.toMatch(/<html:details|<html:summary|Learn more/i);
  });

  it("rule 8: no copy affordance in the markup or the script", () => {
    expect(XHTML_CODE).not.toMatch(/copy/i);
    expect(SCRIPT_CODE).not.toMatch(/clipboard/i);
    expect(SCRIPT_CODE).not.toMatch(/execCommand/);
    // The script *refuses* copy and cut on the field; that is the only mention.
    expect(SCRIPT_CODE).toMatch(/\["copy", "cut"\]/);
  });

  it("rule 9 in the script: no Zotero.Prefs write and no network call", () => {
    expect(SCRIPT_CODE).not.toMatch(/Zotero\.Prefs\.set/);
    expect(SCRIPT_CODE).not.toMatch(/Zotero\.Prefs\.get/);
    expect(SCRIPT_CODE).not.toMatch(/\bfetch\s*\(/);
    expect(SCRIPT_CODE).not.toMatch(/XMLHttpRequest|Zotero\.HTTP/);
    expect(SCRIPT_CODE).not.toMatch(/OSKeyStore|Services\.logins/);
  });
});

/* ------------------------------------------------------ 11. the controller */

type Handler = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  target?: FakeElement;
  key?: string;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

/**
 * The harness's id index, so an element the script builds (`P3-T14`) is
 * found by `getElementById` once it is inserted, as in a real document.
 */
let liveIndex: Map<string, FakeElement> | undefined;

class FakeElement {
  readonly listeners = new Map<string, Handler[]>();
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | undefined;
  /** Elements inserted with `after()` on an element that has no parent. */
  readonly following: FakeElement[] = [];
  type = "";
  value = "";
  placeholder = "";
  disabled = false;
  hidden = false;
  textContent = "";
  constructor(
    public id: string,
    readonly tag = "",
  ) {}
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  private adopt(child: FakeElement): void {
    child.parentNode = this;
    child.register();
  }
  register(): void {
    if (this.id !== "") liveIndex?.set(this.id, this);
    for (const child of this.children) child.register();
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    this.adopt(child);
    return child;
  }
  after(node: FakeElement): void {
    const parent = this.parentNode;
    if (parent === undefined) {
      this.following.push(node);
      node.register();
      return;
    }
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    parent.adopt(node);
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent === undefined) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentNode = undefined;
    if (liveIndex?.get(this.id) === this) liveIndex.delete(this.id);
  }
  dispatchEvent(event: { type: string }): boolean {
    this.fire(event.type);
    return true;
  }
  get classList() {
    return {
      toggle: (name: string, on: boolean) => {
        if (on) this.classes.add(name);
        else this.classes.delete(name);
      },
      contains: (name: string) => this.classes.has(name),
    };
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(type: string, handler: Handler) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }
  fire(type: string, extra: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...extra,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }
}

interface PaneController {
  spec: {
    root: string;
    credentials: Record<string, string>;
    testable: string[];
    providers: Record<string, string>;
    providerMenu: string;
    providerBlockPrefix: string;
    restoreNote: string;
  };
  l10n: Record<string, string>;
  OS_KEYSTORE: string;
  SESSION: string;
  host: Record<string, unknown> | null;
  logic: {
    badge: (
      pref: string,
      platform: string,
      ctx: unknown,
    ) => {
      messageId: string;
      warning: boolean;
      canStore: boolean;
      osStore: boolean;
    };
    restoreNotice: (state: unknown, badge: { osStore: boolean }) => boolean;
    riskOpening: (pref: string, ctx: unknown) => string;
    riskOwnAccount: (pref: string, ctx: unknown) => string;
    baseUrlMessage: (result: unknown, l10n: unknown) => { id: string };
    platform: (z: unknown) => string;
    formatTime: (iso: string) => string;
  };
  init: (root: FakeElement) => Promise<void>;
  normalizeForDisplay: (raw: string) => string;
}

interface PaneHarness {
  controller: PaneController;
  byId: (id: string) => FakeElement;
  debugLines: string[];
  docListeners: Map<string, Handler[]>;
  l10nCalls: { id: string; element: string; args?: unknown }[];
  root: FakeElement;
}

function paneHarness(options: {
  host?: Record<string, unknown>;
  platform?: "win" | "mac" | "linux";
}): PaneHarness {
  const ids = [...XHTML_CODE.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
  const index = new Map<string, FakeElement>();
  liveIndex = index;
  for (const id of ids) index.set(id, new FakeElement(id));
  const docListeners = new Map<string, Handler[]>();
  const l10nCalls: PaneHarness["l10nCalls"] = [];
  const debugLines: string[] = [];
  const doc = {
    getElementById: (id: string) => index.get(id) ?? null,
    createElementNS: (_ns: string, tag: string) => new FakeElement("", tag),
    createXULElement: (tag: string) => new FakeElement("", tag),
    addEventListener: (type: string, handler: Handler) => {
      const bucket = docListeners.get(type) ?? [];
      bucket.push(handler);
      docListeners.set(type, bucket);
    },
    l10n: {
      setAttributes: (element: FakeElement, id: string, args?: unknown) => {
        element.setAttribute("data-l10n-id", id);
        if (args !== undefined) {
          element.setAttribute("data-l10n-args", JSON.stringify(args));
        }
        l10nCalls.push({ id, element: element.id, args });
      },
    },
  };
  const platform = options.platform ?? "win";
  const zotero = {
    debug: (line: unknown) => {
      debugLines.push(String(line));
    },
    locale: "en-US",
    isWin: platform === "win",
    isMac: platform === "mac",
    isLinux: platform === "linux",
    launchURL: () => undefined,
    __addonInstance__: options.host
      ? { api: { preferences: options.host } }
      : undefined,
  };
  const win = {
    setTimeout: (fn: () => void) => fn(),
    Event: class {
      constructor(readonly type: string) {}
    },
  };
  const factory = new Function(
    "Zotero",
    "window",
    "document",
    `${SCRIPT}\nreturn RHPreferences;`,
  ) as (z: unknown, w: unknown, d: unknown) => PaneController;
  const controller = factory(zotero, win, doc);
  return {
    controller,
    byId: (id) => {
      const el = index.get(id);
      if (!el) throw new Error(`no element ${id}`);
      return el;
    },
    debugLines,
    docListeners,
    l10nCalls,
    root: index.get(PREFERENCES_ROOT_ID)!,
  };
}

/** A fake host with the shipped API's shape and a recording of every call. */
function fakeHost(options: {
  storeAvailable?: boolean;
  backendPref?: string;
  present?: Partial<Record<string, boolean>>;
  test?: (id: string) => Promise<TestReport>;
  activeProvider?: string;
  baseUrls?: Partial<Record<ProviderId, string>>;
  pluginDataPresent?: boolean;
}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const present: Record<string, boolean> = Object.fromEntries(
    PANE_CREDENTIALS.map(({ id }) => [id, options.present?.[id] === true]),
  );
  const baseUrls: Partial<Record<ProviderId, string>> = {
    ...options.baseUrls,
  };
  const host = {
    paneId: PREFERENCES_PANE_ID,
    calls,
    baseUrls,
    readState: () => {
      calls.push({ method: "readState", args: [] });
      return Promise.resolve({
        backendPref: options.backendPref ?? OS_KEYSTORE_PREF_VALUE,
        storeAvailable: options.storeAvailable ?? true,
        credentials: Object.entries(present).map(([id, isPresent]) => ({
          id,
          present: isPresent,
          lastTest: undefined,
        })),
        activeProvider: options.activeProvider ?? "openrouter",
        providers: LLM_CREDENTIALS.map(({ provider }) => ({
          provider,
          baseUrl: baseUrls[provider] ?? "",
        })),
        pluginDataPresent: options.pluginDataPresent ?? false,
        anyKeyStored: Object.values(present).some(Boolean),
      });
    },
    setBaseUrl: (provider: ProviderId, raw: string) => {
      calls.push({ method: "setBaseUrl", args: [provider, raw] });
      const checked = checkBaseUrlInput(raw);
      if (!checked.ok) {
        return Promise.resolve<BaseUrlResult>({
          stored: false,
          reason: checked.reason,
        });
      }
      baseUrls[provider] = checked.value;
      return Promise.resolve<BaseUrlResult>({
        stored: true,
        cleared: checked.value === "",
      });
    },
    storeKey: (id: string, raw: string) => {
      calls.push({ method: "storeKey", args: [id, raw] });
      const value = normalizeKeyInput(raw);
      present[id] = true;
      return Promise.resolve({
        stored: true as const,
        digest: keyDigest(value),
      });
    },
    clearKey: (id: string) => {
      calls.push({ method: "clearKey", args: [id] });
      const had = present[id] === true;
      present[id] = false;
      return Promise.resolve(had);
    },
    clearAllKeys: () => {
      calls.push({ method: "clearAllKeys", args: [] });
      const count = Object.values(present).filter(Boolean).length;
      for (const id of Object.keys(present)) present[id] = false;
      return Promise.resolve(count);
    },
    testKey: (id: string) => {
      calls.push({ method: "testKey", args: [id] });
      return (
        options.test?.(id) ??
        Promise.resolve<TestReport>({
          kind: "tested",
          outcome: "ok",
          checkedAt: "2026-10-13T09:00:00.000Z",
        })
      );
    },
  };
  return host;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("P1-T44 — the controller, evaluated from the shipped bytes", () => {
  it("agrees with preferencesPane.ts on every literal it duplicates", () => {
    const h = paneHarness({});
    expect(h.controller.spec.root).toBe(PREFERENCES_ROOT_ID);
    expect(h.controller.OS_KEYSTORE).toBe(OS_KEYSTORE_PREF_VALUE);
    expect(h.controller.SESSION).toBe(SESSION_PREF_VALUE);
    expect(h.controller.spec.credentials).toEqual(
      Object.fromEntries(PANE_CREDENTIALS.map((c) => [c.id, c.elementPrefix])),
    );
    expect(h.controller.spec.testable).toEqual(
      PANE_CREDENTIALS.map((c) => c.id).filter(isTestableCredential),
    );
    expect(h.controller.spec.providers).toEqual(
      Object.fromEntries(
        LLM_CREDENTIALS.map((c) => [c.provider, c.elementPrefix]),
      ),
    );
    const known = new Set<string>(Object.values(PREFERENCES_L10N));
    for (const [name, id] of Object.entries(h.controller.l10n)) {
      expect(known.has(id), `l10n.${name} = ${id} is in PREFERENCES_L10N`).toBe(
        true,
      );
    }
    // The badge table is the same table.
    for (const platform of ["win", "mac", "linux", "other"]) {
      for (const pref of ["oskeystore", "", "session", "passphrase"]) {
        const expected = backendBadge(pref, platform as "win");
        const actual = h.controller.logic.badge(pref, platform, h.controller);
        expect(actual).toEqual({
          messageId: expected.messageId,
          warning: expected.warning,
          canStore: expected.canStore,
          osStore: expected.osStore,
        });
      }
    }
    // So is the restore rule.
    for (const pluginDataPresent of [true, false]) {
      for (const anyPresent of [true, false]) {
        for (const osStore of [true, false]) {
          const state = { anyKeyStored: anyPresent, pluginDataPresent };
          expect(h.controller.logic.restoreNotice(state, { osStore })).toBe(
            showRestoreNotice(state, { osStore }),
          );
        }
      }
    }
  });

  it("initialises from a capturing load listener on the document, not an inline handler", async () => {
    const host = fakeHost({});
    const h = paneHarness({ host });
    const loads = h.docListeners.get("load") ?? [];
    expect(loads).toHaveLength(1);
    // `new Function` cannot expose the `useCapture` flag; the source is asserted.
    expect(SCRIPT_CODE).toMatch(
      /addEventListener\(\s*"load",[\s\S]*?,\s*true,?\s*\)/,
    );
    loads[0]!({
      type: "load",
      target: h.root,
      defaultPrevented: false,
      preventDefault() {},
    });
    await flush();
    await flush();
    expect(h.root.getAttribute("data-rh-initialized")).toBe("true");
    expect(host.calls.map((c) => c.method)).toContain("readState");
    // A load for some other element is ignored.
    loads[0]!({
      type: "load",
      target: new FakeElement("something-else"),
      defaultPrevented: false,
      preventDefault() {},
    });
  });

  it("paints the badge, mirrors it beside each field, and disables everything when no store is live", async () => {
    const host = fakeHost({ storeAvailable: false });
    const h = paneHarness({ host, platform: "win" });
    await h.controller.init(h.root);
    const badge = h.byId("rh-prefs-backend");
    expect(badge.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.backendUnavailable,
    );
    expect(badge.classes.has("rh-warning")).toBe(true);
    for (const { elementPrefix } of SOURCE_CREDENTIALS) {
      expect(
        h.byId(`${elementPrefix}-backend`).getAttribute("data-l10n-id"),
      ).toBe(PREFERENCES_L10N.backendUnavailable);
      expect(h.byId(`${elementPrefix}-key`).disabled).toBe(true);
      expect(h.byId(`${elementPrefix}-test`).disabled).toBe(true);
      expect(h.byId(`${elementPrefix}-clear`).disabled).toBe(true);
    }
    expect(h.byId("rh-prefs-remove-all").disabled).toBe(true);
  });

  it("on Windows names the Credential Manager and uses the restore sentence for an absent key", async () => {
    const h = paneHarness({ host: fakeHost({}), platform: "win" });
    await h.controller.init(h.root);
    expect(h.byId("rh-prefs-backend").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.backendWindows,
    );
    expect(h.byId("rh-ncbi-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.keyAbsentOs,
    );
  });

  it("on Linux does not claim a tier and uses the plain absent sentence", async () => {
    const h = paneHarness({ host: fakeHost({}), platform: "linux" });
    await h.controller.init(h.root);
    expect(h.byId("rh-prefs-backend").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.backendIndeterminate,
    );
    expect(h.byId("rh-ncbi-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.keyAbsent,
    );
  });

  it("rule 1: the reveal is hold-to-show — pressed shows, released or left hides, never a toggle", async () => {
    const h = paneHarness({ host: fakeHost({}) });
    await h.controller.init(h.root);
    const input = h.byId("rh-ncbi-key");
    const reveal = h.byId("rh-ncbi-reveal");
    input.type = "password";
    reveal.fire("mousedown");
    expect(input.type).toBe("text");
    reveal.fire("mouseup");
    expect(input.type).toBe("password");
    reveal.fire("mousedown");
    expect(input.type).toBe("text");
    reveal.fire("mouseleave");
    expect(input.type).toBe("password");
    reveal.fire("keydown", { key: " " });
    expect(input.type).toBe("text");
    reveal.fire("keyup", { key: " " });
    expect(input.type).toBe("password");
    reveal.fire("keydown", { key: "Enter" });
    expect(input.type).toBe("text");
    reveal.fire("blur");
    expect(input.type).toBe("password");
    // A click's `command` must not flip it back on.
    const command = reveal.fire("command");
    expect(command.defaultPrevented).toBe(true);
    expect(input.type).toBe("password");
  });

  it("rule 2 and 7: change stores the raw field through the host, empties the field, shows the digest as placeholder", async () => {
    const host = fakeHost({});
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    const input = h.byId("rh-s2-key");
    const key = syntheticKey(40);
    input.value = `Bearer ${key}`;
    input.type = "text";
    input.fire("change");
    await flush();
    await flush();
    const store = host.calls.find((c) => c.method === "storeKey");
    expect(store?.args).toEqual(["source.semanticscholar", `Bearer ${key}`]);
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe(keyDigest(key));
    expect(input.placeholder.includes(key)).toBe(false);
    expect(h.byId("rh-s2-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.keyPresent,
    );
    expect(h.byId("rh-s2-test").disabled).toBe(false);
    // An empty change is not a store.
    input.value = "";
    input.fire("change");
    await flush();
    expect(host.calls.filter((c) => c.method === "storeKey")).toHaveLength(1);
  });

  it("rule 7 on paste: the visible value is normalised for display", async () => {
    const h = paneHarness({ host: fakeHost({}) });
    await h.controller.init(h.root);
    const input = h.byId("rh-ncbi-key");
    const key = syntheticKey();
    input.value = `  bearer ${key} `;
    input.fire("paste");
    expect(input.value).toBe(key);
    expect(h.controller.normalizeForDisplay(` Bearer ${key}`)).toBe(
      normalizeKeyInput(` Bearer ${key}`),
    );
  });

  it("rule 8: copy and cut on a key field are refused", async () => {
    const h = paneHarness({ host: fakeHost({}) });
    await h.controller.init(h.root);
    for (const { elementPrefix } of SOURCE_CREDENTIALS) {
      const input = h.byId(`${elementPrefix}-key`);
      expect(input.fire("copy").defaultPrevented).toBe(true);
      expect(input.fire("cut").defaultPrevented).toBe(true);
    }
  });

  it("rule 5: Test paints the running state, then the outcome with a formatted time, inline", async () => {
    const host = fakeHost({
      present: { "source.ncbi": true },
      test: () =>
        Promise.resolve<TestReport>({
          kind: "tested",
          outcome: "inconclusive",
          reason: "unkeyed-budget",
          checkedAt: "2026-10-13T09:05:00.000Z",
        }),
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    h.byId("rh-ncbi-test").fire("command");
    const running = h.l10nCalls.find(
      (c) =>
        c.element === "rh-ncbi-status" && c.id === PREFERENCES_L10N.testRunning,
    );
    expect(running).toBeDefined();
    await flush();
    await flush();
    const status = h.byId("rh-ncbi-status");
    expect(status.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.testInconclusive,
    );
    const args = JSON.parse(status.getAttribute("data-l10n-args")!) as {
      time: string;
    };
    expect(args.time).toBe(
      h.controller.logic.formatTime("2026-10-13T09:05:00.000Z"),
    );
    expect(args.time).not.toContain("2026-10-13T"); // formatted, not ISO
    expect(host.calls.filter((c) => c.method === "testKey")).toHaveLength(1);
  });

  it("rule 5: a rejecting host is 'could not verify', and the error's text reaches neither the pane nor the log", async () => {
    const key = syntheticKey();
    const host = fakeHost({
      present: { "source.ncbi": true },
      test: () => Promise.reject(new Error(`leaked ${key} in a message`)),
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    h.byId("rh-ncbi-test").fire("command");
    await flush();
    await flush();
    const status = h.byId("rh-ncbi-status");
    expect(status.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.testInconclusive,
    );
    const everything = [
      ...h.debugLines,
      ...[...h.root.attributes.values()],
      status.getAttribute("data-l10n-args") ?? "",
    ].join("\n");
    expect(everything.includes(key)).toBe(false);
    expect(h.debugLines.some((line) => line.includes("testKey failed"))).toBe(
      true,
    );
    expect(h.debugLines.join("\n")).not.toContain("leaked");
  });

  it("rule 6: Remove all clears through the host and reports the count inline", async () => {
    const host = fakeHost({
      present: { "source.ncbi": true, "source.semanticscholar": true },
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    h.byId("rh-ncbi-key").placeholder = "abc…••••••••wxyz";
    h.byId("rh-prefs-remove-all").fire("command");
    await flush();
    await flush();
    expect(host.calls.some((c) => c.method === "clearAllKeys")).toBe(true);
    const status = h.byId("rh-prefs-remove-all-status");
    expect(status.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.removeAllDone,
    );
    expect(JSON.parse(status.getAttribute("data-l10n-args")!)).toEqual({
      count: 2,
    });
    expect(h.byId("rh-ncbi-key").placeholder).toBe("");
    expect(h.byId("rh-ncbi-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.keyAbsentOs,
    );
  });

  it("Clear removes through the host, empties field and placeholder, and says so", async () => {
    const host = fakeHost({ present: { "source.ncbi": true } });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    const input = h.byId("rh-ncbi-key");
    input.placeholder = "abc…••••••••wxyz";
    h.byId("rh-ncbi-clear").fire("command");
    await flush();
    await flush();
    expect(host.calls.some((c) => c.method === "clearKey")).toBe(true);
    expect(input.placeholder).toBe("");
    expect(h.byId("rh-ncbi-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.keyCleared,
    );
  });

  it("with no host published, initialises inert: unavailable badge, every control disabled, nothing thrown", async () => {
    const h = paneHarness({});
    await h.controller.init(h.root);
    expect(h.byId("rh-prefs-backend").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.backendUnavailable,
    );
    expect(h.byId("rh-ncbi-key").disabled).toBe(true);
    h.byId("rh-ncbi-test").fire("command");
    h.byId("rh-prefs-remove-all").fire("command");
    await flush();
    expect(h.debugLines).toEqual([]);
  });
});

describe("P3-T04 — the controller's LLM provider blocks, evaluated from the shipped bytes", () => {
  it("tier 2: paints 'Not saved between sessions' as a warning and keeps every key field usable", async () => {
    const h = paneHarness({
      host: fakeHost({ backendPref: SESSION_PREF_VALUE }),
      platform: "win",
    });
    await h.controller.init(h.root);
    const badge = h.byId("rh-prefs-backend");
    expect(badge.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.backendSession,
    );
    expect(badge.classes.has("rh-warning")).toBe(true);
    for (const { elementPrefix } of PANE_CREDENTIALS) {
      expect(
        h.byId(`${elementPrefix}-backend`).getAttribute("data-l10n-id"),
      ).toBe(PREFERENCES_L10N.backendSession);
      expect(h.byId(`${elementPrefix}-key`).disabled).toBe(false);
      expect(h.byId(`${elementPrefix}-reveal`).disabled).toBe(false);
      // Not an OS store: the "does not travel" sentence is not used.
      expect(
        h.byId(`${elementPrefix}-status`).getAttribute("data-l10n-id"),
      ).toBe(PREFERENCES_L10N.keyAbsent);
    }
    expect(h.byId("rh-prefs-remove-all").disabled).toBe(false);
  });

  it("stores, masks and clears a synthetic key in each LLM block through the host", async () => {
    const host = fakeHost({});
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    for (const { id, elementPrefix } of LLM_CREDENTIALS) {
      const input = h.byId(`${elementPrefix}-key`);
      const key = `sk-rhsyn-${syntheticKey(40)}`;
      input.value = key;
      input.fire("change");
      await flush();
      await flush();
      expect(
        host.calls.filter((c) => c.method === "storeKey").at(-1)?.args,
      ).toEqual([id, key]);
      expect(input.value).toBe("");
      expect(input.type).toBe("password");
      expect(input.placeholder).toBe(keyDigest(key));
      expect(
        h.byId(`${elementPrefix}-status`).getAttribute("data-l10n-id"),
      ).toBe(PREFERENCES_L10N.keyPresent);
      expect(h.byId(`${elementPrefix}-clear`).disabled).toBe(false);
      expect(input.fire("copy").defaultPrevented).toBe(true);
      h.byId(`${elementPrefix}-clear`).fire("command");
      await flush();
      await flush();
      expect(
        host.calls.filter((c) => c.method === "clearKey").at(-1)?.args,
      ).toEqual([id]);
      expect(input.placeholder).toBe("");
    }
  });

  it("P3-T14: enables each LLM Test with a key stored, paints the outcome inline (a 429 pass and an out-of-credit pass each say so) and refills that provider's suggestions", async () => {
    const host = fakeHost({
      present: Object.fromEntries(LLM_CREDENTIALS.map(({ id }) => [id, true])),
      test: (id) =>
        Promise.resolve<TestReport>({
          kind: "tested",
          outcome: "ok",
          checkedAt: "2026-10-23T09:00:00.000Z",
          ...(id === "llm.openai" && { rateLimited: true as const }),
          // Item 279(a): the out-of-credit line.
          ...(id === "llm.anthropic" && { noCredit: true as const }),
          models: [`${id}-model-a`, `${id}-model-b`],
        }),
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    for (const { id, elementPrefix } of LLM_CREDENTIALS) {
      const test = h.byId(`${elementPrefix}-test`);
      expect(test.disabled).toBe(false);
      test.fire("command");
      await flush();
      await flush();
      expect(
        h.byId(`${elementPrefix}-status`).getAttribute("data-l10n-id"),
      ).toBe(
        id === "llm.openai"
          ? PREFERENCES_L10N.testOkRateLimited
          : id === "llm.anthropic"
            ? PREFERENCES_L10N.testOkNoCredit
            : PREFERENCES_L10N.testOk,
      );
      const popup = h.byId(`${elementPrefix}-model-suggestions`).firstChild!;
      expect(popup.children.map((item) => item.getAttribute("value"))).toEqual([
        "",
        `${id}-model-a`,
        `${id}-model-b`,
      ]);
    }
    expect(
      host.calls.filter((c) => c.method === "testKey").map((c) => c.args[0]),
    ).toEqual(LLM_CREDENTIALS.map(({ id }) => id));
  });

  it("rule 4: shows only the active provider's block, and follows the menulist", async () => {
    const h = paneHarness({ host: fakeHost({ activeProvider: "gemini" }) });
    await h.controller.init(h.root);
    const visible = () =>
      LLM_CREDENTIALS.map(({ provider }) => provider).filter(
        (provider) => !h.byId(`rh-provider-${provider}`).hidden,
      );
    expect(visible()).toEqual(["gemini"]);
    const menu = h.byId("rh-provider");
    menu.value = "anthropic";
    menu.fire("command");
    expect(visible()).toEqual(["anthropic"]);
    // Zotero paints the stored value after the pane's load.
    menu.value = "openai";
    menu.fire("syncfrompreference");
    expect(visible()).toEqual(["openai"]);
    // A value the pane has no block for falls back to docs/07 §8.5's default.
    menu.value = "mistral";
    menu.fire("command");
    expect(visible()).toEqual(["openrouter"]);
  });

  it("paints each stored base URL once, and writes a changed one through the host with the outcome inline", async () => {
    const host = fakeHost({
      baseUrls: { anthropic: "https://gw.example/anthropic" },
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    expect(h.byId("rh-anthropic-base-url").value).toBe(
      "https://gw.example/anthropic",
    );
    expect(h.byId("rh-or-base-url").value).toBe("");
    expect(h.byId("rh-or-base-url").disabled).toBe(false);

    const input = h.byId("rh-openai-base-url");
    const status = h.byId("rh-openai-base-url-status");
    const cases: [string, string, string | undefined][] = [
      ["http://proxy.example/v1", PREFERENCES_L10N.baseUrlNotHttps, undefined],
      [
        "https://proxy.example/v1/",
        PREFERENCES_L10N.baseUrlTrailingSlash,
        undefined,
      ],
      [
        "https://u:p@proxy.example/v1",
        PREFERENCES_L10N.baseUrlInvalid,
        undefined,
      ],
      [
        " https://proxy.example/v1 ",
        PREFERENCES_L10N.baseUrlSaved,
        "https://proxy.example/v1",
      ],
      ["", PREFERENCES_L10N.baseUrlDefault, ""],
    ];
    for (const [typed, message, stored] of cases) {
      input.value = typed;
      input.fire("change");
      await flush();
      await flush();
      expect(status.getAttribute("data-l10n-id"), typed).toBe(message);
      expect(
        host.calls.filter((c) => c.method === "setBaseUrl").at(-1)?.args,
      ).toEqual(["openai", typed]);
      if (stored === undefined) {
        // Refused: the field keeps exactly what the user typed.
        expect(input.value).toBe(typed);
      } else {
        expect(host.baseUrls.openai).toBe(stored);
        expect(input.value).toBe(stored);
      }
    }
    // A key store refreshes the pane but does not repaint the base URLs.
    input.value = "https://half-typed";
    h.byId("rh-openai-key").value = syntheticKey();
    h.byId("rh-openai-key").fire("change");
    await flush();
    await flush();
    expect(input.value).toBe("https://half-typed");
  });

  it("with no host, the base-URL fields are disabled and nothing is written", async () => {
    const h = paneHarness({});
    await h.controller.init(h.root);
    for (const { elementPrefix } of LLM_CREDENTIALS) {
      expect(h.byId(`${elementPrefix}-base-url`).disabled).toBe(true);
      expect(h.byId(`${elementPrefix}-key`).disabled).toBe(true);
    }
    expect(h.byId("rh-provider-openrouter").hidden).toBe(false);
    expect(h.byId("rh-prefs-restore-note").hidden).toBe(true);
  });

  it("docs/09 §1.9 item 8: shows the restore notice only for no keys, plugin data and an OS store", async () => {
    const shown = async (
      options: Parameters<typeof fakeHost>[0],
      platform: "win" | "linux" = "win",
    ) => {
      const h = paneHarness({ host: fakeHost(options), platform });
      await h.controller.init(h.root);
      return !h.byId("rh-prefs-restore-note").hidden;
    };
    expect(await shown({ pluginDataPresent: true })).toBe(true);
    expect(await shown({ pluginDataPresent: false })).toBe(false);
    expect(
      await shown({
        pluginDataPresent: true,
        present: { "llm.anthropic": true },
      }),
    ).toBe(false);
    expect(await shown({ pluginDataPresent: true }, "linux")).toBe(false);
    expect(
      await shown({ pluginDataPresent: true, backendPref: SESSION_PREF_VALUE }),
    ).toBe(false);
  });
});

/* ------------------------------- P3-T14: the LLM Test, suggestions, prices */

const KO_FTL = readFileSync(
  resolve(root, "addon/locale/ko-KR/research-helper-mainWindow.ftl"),
  "utf8",
);

/** The twenty ids P3-T14 adds to PREFERENCES_L10N. */
const P3T14_IDS = [
  PREFERENCES_L10N.testOkRateLimited,
  PREFERENCES_L10N.modelSuggestions,
  PREFERENCES_L10N.modelsAsOf,
  PREFERENCES_L10N.modelsStale,
  PREFERENCES_L10N.pricesTitle,
  PREFERENCES_L10N.pricesNote,
  PREFERENCES_L10N.priceRow,
  PREFERENCES_L10N.priceRowNoCached,
  PREFERENCES_L10N.priceModel,
  PREFERENCES_L10N.priceInput,
  PREFERENCES_L10N.priceOutput,
  PREFERENCES_L10N.priceCached,
  PREFERENCES_L10N.priceAsOf,
  PREFERENCES_L10N.priceSave,
  PREFERENCES_L10N.priceRemove,
  PREFERENCES_L10N.priceSaved,
  PREFERENCES_L10N.priceRemoved,
  PREFERENCES_L10N.priceInvalid,
  PREFERENCES_L10N.priceRefused,
  PREFERENCES_L10N.priceUnavailable,
];

describe("P3-T14 — the host: classification, persistence, suggestions, prices", () => {
  it("classifyLlmCheck: ok (a 429 flagged, an out-of-credit answer flagged apart), rejected, forbidden, else inconclusive — no-answer only without a status", () => {
    const cases: [LlmKeyCheck, ReturnType<typeof classifyLlmCheck>][] = [
      [
        { ok: true, messageKey: PREFERENCES_L10N.testOk, httpStatus: 200 },
        { outcome: "ok", rateLimited: false, noCredit: false },
      ],
      [
        { ok: true, messageKey: "rh-error-rate-limit", httpStatus: 429 },
        { outcome: "ok", rateLimited: true, noCredit: false },
      ],
      // Item 279(a): a spend cap is a pass with its own line, never the 429
      // line — a 429 (OpenAI, Anthropic) and OpenRouter's 402 alike.
      [
        { ok: true, messageKey: NO_CREDIT_MESSAGE_KEY, httpStatus: 429 },
        { outcome: "ok", rateLimited: false, noCredit: true },
      ],
      [
        { ok: true, messageKey: NO_CREDIT_MESSAGE_KEY, httpStatus: 402 },
        { outcome: "ok", rateLimited: false, noCredit: true },
      ],
      [
        { ok: false, messageKey: REJECTED_MESSAGE_KEY, httpStatus: 401 },
        { outcome: "rejected", rateLimited: false, noCredit: false },
      ],
      [
        { ok: false, messageKey: REJECTED_MESSAGE_KEY, httpStatus: 400 },
        { outcome: "rejected", rateLimited: false, noCredit: false },
      ],
      [
        { ok: false, messageKey: FORBIDDEN_MESSAGE_KEY, httpStatus: 403 },
        { outcome: "forbidden", rateLimited: false, noCredit: false },
      ],
      [
        { ok: false, messageKey: "rh-error-upstream", httpStatus: 503 },
        {
          outcome: "inconclusive",
          reason: "request-failed",
          rateLimited: false,
          noCredit: false,
        },
      ],
      [
        { ok: false, messageKey: "rh-error-network" },
        {
          outcome: "inconclusive",
          reason: "no-answer",
          rateLimited: false,
          noCredit: false,
        },
      ],
    ];
    for (const [check, expected] of cases) {
      expect(classifyLlmCheck(check), JSON.stringify(check)).toEqual(expected);
    }
  });

  function recordingValidation() {
    const rows = new Map<SecretId, { result: string; at: string }>();
    const writes: [SecretId, string, string][] = [];
    return {
      rows,
      writes,
      port: {
        read: (id: SecretId) => rows.get(id),
        record: (id: SecretId, result: string, at: string) => {
          writes.push([id, result, at]);
          rows.set(id, { result, at });
        },
      },
    };
  }

  it("persists every answered outcome of all six through the port, and never one with no answer", async () => {
    const v = recordingValidation();
    let llmAnswer: () => Promise<LlmKeyCheck> = () =>
      Promise.resolve({
        ok: false,
        messageKey: REJECTED_MESSAGE_KEY,
        httpStatus: 401,
      });
    let sourceAnswer: () => Promise<HttpResponse> = () =>
      Promise.resolve(response(200, "{}", { "X-Ratelimit-Limit": "10" }));
    const h = hostHarness(() => sourceAnswer(), {
      ports: { validateLlm: () => llmAnswer(), validation: v.port },
    });
    await h.host.storeKey("llm.anthropic", syntheticKey());
    await h.host.storeKey("source.ncbi", syntheticKey());
    const at = new Date(h.clock.now()).toISOString();

    expect(await h.host.testKey("llm.anthropic")).toMatchObject({
      outcome: "rejected",
    });
    expect(await h.host.testKey("source.ncbi")).toMatchObject({
      outcome: "ok",
    });
    expect(v.writes).toEqual([
      ["llm.anthropic", "rejected", at],
      ["source.ncbi", "ok", at],
    ]);

    // No answer: nothing written, the stored rows stay.
    llmAnswer = () => Promise.reject(new NetworkError("synthetic", {}));
    sourceAnswer = () => Promise.reject(new NetworkError("synthetic", {}));
    expect(await h.host.testKey("llm.anthropic")).toMatchObject({
      outcome: "inconclusive",
      reason: "no-answer",
    });
    expect(await h.host.testKey("source.ncbi")).toMatchObject({
      outcome: "inconclusive",
      reason: "no-answer",
    });
    expect(v.writes).toHaveLength(2);

    // readState paints from the stored rows, not from the last Test.
    const state = await h.host.readState();
    expect(
      state.credentials.find((c) => c.id === "llm.anthropic")?.lastTest,
    ).toEqual({ kind: "tested", outcome: "rejected", checkedAt: at });
    expect(
      state.credentials.find((c) => c.id === "source.ncbi")?.lastTest,
    ).toEqual({ kind: "tested", outcome: "ok", checkedAt: at });
    // A stored value outside the enum, or never tested, paints nothing.
    v.rows.set("llm.openai", { result: "", at: "" });
    v.rows.set("llm.gemini", { result: "nonsense", at });
    const again = await h.host.readState();
    for (const id of ["llm.openai", "llm.gemini"]) {
      expect(
        again.credentials.find((c) => c.id === id)?.lastTest,
      ).toBeUndefined();
    }
  });

  it("an LLM Test with no adapter port bound, or one that throws, is inconclusive with no answer and logs no message", async () => {
    const key = syntheticKey();
    const none = hostHarness(() => Promise.reject(new Error("unused")));
    await none.host.storeKey("llm.openai", key);
    expect(await none.host.testKey("llm.openai")).toMatchObject({
      outcome: "inconclusive",
      reason: "no-answer",
    });
    const throwing = hostHarness(() => Promise.reject(new Error("unused")), {
      ports: {
        validateLlm: () =>
          Promise.reject(new Error(`leaked ${key} in a message`)),
      },
    });
    await throwing.host.storeKey("llm.openai", key);
    expect(await throwing.host.testKey("llm.openai")).toMatchObject({
      outcome: "inconclusive",
      reason: "no-answer",
    });
    const lines = throwing.sink.lines.join("\n");
    expect(lines).not.toContain("leaked");
    expect(lines.includes(key)).toBe(false);
  });

  it("modelSuggestions passes the catalogue's answer through, and reads a failure as none", async () => {
    const suggestions: ModelSuggestions = {
      providers: [{ provider: "openai", models: ["gpt-a"] }],
      asOfEpochMs: Date.UTC(2026, 8, 8),
      stale: true,
    };
    const h = hostHarness(() => Promise.reject(new Error("unused")), {
      ports: { modelSuggestions: () => Promise.resolve(suggestions) },
    });
    expect(await h.host.modelSuggestions()).toEqual(suggestions);
    const failing = hostHarness(() => Promise.reject(new Error("unused")), {
      ports: { modelSuggestions: () => Promise.reject(new Error("offline")) },
    });
    expect(await failing.host.modelSuggestions()).toBeUndefined();
    const absent = hostHarness(() => Promise.reject(new Error("unused")));
    expect(await absent.host.modelSuggestions()).toBeUndefined();
  });

  it("parsePriceInput: plain decimals of zero or more, an optional cached price, a real YYYY-MM-DD day; anything else refused", () => {
    const good: PriceInput = {
      provider: "openai",
      modelId: "  gpt-a  ",
      input: "0.25",
      output: "1.5",
      cached: "",
      asOf: "2026-10-23",
    };
    expect(parsePriceInput(good)).toEqual({
      providerId: "openai",
      modelId: "gpt-a",
      inputPerMTokUsd: 0.25,
      outputPerMTokUsd: 1.5,
      asOfEpochMs: Date.UTC(2026, 9, 23),
    });
    expect(parsePriceInput({ ...good, cached: "0" })).toMatchObject({
      cachedInputPerMTokUsd: 0,
    });
    const bads: Partial<PriceInput>[] = [
      { provider: "mistral" },
      { modelId: "   " },
      { input: "-1" },
      { input: "1e3" },
      { output: "" },
      { output: "1,000" },
      { cached: "free" },
      { asOf: "2026-02-30" },
      { asOf: "23/10/2026" },
      { asOf: "" },
    ];
    for (const bad of bads) {
      expect(
        parsePriceInput({ ...good, ...bad }),
        JSON.stringify(bad),
      ).toBeUndefined();
    }
  });

  it("savePrice: invalid before the store, refused when the store refuses (model ID never logged), unavailable without one; list and delete go through", async () => {
    const rows: PriceRow[] = [];
    let refuse = false;
    const prices: PricesPort = {
      list: () => Promise.resolve([...rows]),
      upsert: (row) => {
        if (refuse) return Promise.reject(new RangeError("refused"));
        rows.push(row);
        return Promise.resolve();
      },
      delete: (providerId, modelId) => {
        const at = rows.findIndex(
          (r) => r.providerId === providerId && r.modelId === modelId,
        );
        if (at >= 0) rows.splice(at, 1);
        return Promise.resolve();
      },
    };
    const h = hostHarness(() => Promise.reject(new Error("unused")), {
      ports: { prices },
    });
    const input: PriceInput = {
      provider: "anthropic",
      modelId: "claude-rhsyn",
      input: "1",
      output: "5",
      cached: "0.1",
      asOf: "2026-10-23",
    };
    expect(await h.host.savePrice({ ...input, input: "x" })).toEqual({
      saved: false,
      reason: "invalid",
    });
    expect(rows).toEqual([]);
    expect(await h.host.savePrice(input)).toEqual({ saved: true });
    expect(await h.host.listPrices()).toEqual([
      {
        providerId: "anthropic",
        modelId: "claude-rhsyn",
        inputPerMTokUsd: 1,
        outputPerMTokUsd: 5,
        cachedInputPerMTokUsd: 0.1,
        asOfEpochMs: Date.UTC(2026, 9, 23),
      },
    ]);
    refuse = true;
    const keyShaped = `sk-${syntheticKey(40)}`;
    expect(await h.host.savePrice({ ...input, modelId: keyShaped })).toEqual({
      saved: false,
      reason: "refused",
    });
    expect(h.sink.lines.join("\n").includes(keyShaped)).toBe(false);
    expect(await h.host.deletePrice("anthropic", "claude-rhsyn")).toBe(true);
    expect(rows).toEqual([]);
    await expect(h.host.deletePrice("mistral", "x")).rejects.toThrow(
      RangeError,
    );

    const none = hostHarness(() => Promise.reject(new Error("unused")));
    expect(await none.host.savePrice(input)).toEqual({
      saved: false,
      reason: "unavailable",
    });
    expect(await none.host.listPrices()).toEqual([]);
    expect(await none.host.deletePrice("openai", "x")).toBe(false);
  });
});

describe("P3-T14 — the controller: Test, stored status, model suggestions, price table", () => {
  function suggestionsHost(
    load: () => Promise<ModelSuggestions | undefined>,
  ): ReturnType<typeof fakeHost> & {
    readonly asked: string[];
    modelSuggestions: () => Promise<ModelSuggestions | undefined>;
  } {
    const asked: string[] = [];
    return Object.assign(fakeHost({}), {
      asked,
      modelSuggestions: () => {
        asked.push("modelSuggestions");
        return load();
      },
    });
  }

  const STALE: ModelSuggestions = {
    providers: LLM_CREDENTIALS.map(({ provider }) => ({
      provider,
      models: [`${provider}-bundled-a`, `${provider}-bundled-b`],
    })),
    asOfEpochMs: Date.UTC(2026, 8, 8),
    stale: true,
  };

  type Logic = PaneController["logic"] & {
    formatDate: (epochMs: number) => string;
    priceMessage: (
      row: PriceRow,
      names: Record<string, string>,
      l10n: Record<string, string>,
    ) => { id: string; args: Record<string, string> };
  };

  it("paints each status row from the stored result on load", async () => {
    const host = fakeHost({ present: { "llm.gemini": true } });
    const read = host.readState;
    Object.assign(host, {
      readState: async () => {
        const state = await read();
        return {
          ...state,
          credentials: state.credentials.map((c) =>
            c.id === "llm.gemini"
              ? {
                  ...c,
                  lastTest: {
                    kind: "tested",
                    outcome: "rejected",
                    checkedAt: "2026-10-22T09:00:00.000Z",
                  },
                }
              : c,
          ),
        };
      },
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    expect(h.byId("rh-gemini-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.testRejected,
    );
  });

  it("builds a suggestion list beside each model field, asks nothing on load, and with the catalogue stale shows the bundled list and the stale marker when first opened", async () => {
    const host = suggestionsHost(() => Promise.resolve(STALE));
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    const logic = h.controller.logic as Logic;
    expect(host.asked).toEqual([]);
    for (const { elementPrefix } of LLM_CREDENTIALS) {
      const popup = h.byId(`${elementPrefix}-model-suggestions`).firstChild!;
      expect(popup.children.map((i) => i.getAttribute("value"))).toEqual([""]);
    }
    h.byId("rh-or-model-suggestions").fire("popupshowing");
    h.byId("rh-gemini-model-suggestions").fire("popupshowing");
    await flush();
    await flush();
    // One load serves every list.
    expect(host.asked).toEqual(["modelSuggestions"]);
    for (const { provider, elementPrefix } of LLM_CREDENTIALS) {
      const popup = h.byId(`${elementPrefix}-model-suggestions`).firstChild!;
      expect(popup.children.map((i) => i.getAttribute("value"))).toEqual([
        "",
        `${provider}-bundled-a`,
        `${provider}-bundled-b`,
      ]);
      const status = h.byId(`${elementPrefix}-models-status`);
      expect(status.getAttribute("data-l10n-id")).toBe(
        PREFERENCES_L10N.modelsStale,
      );
      expect(JSON.parse(status.getAttribute("data-l10n-args")!)).toEqual({
        date: logic.formatDate(STALE.asOfEpochMs),
      });
    }
  });

  it("a live list says 'as of' instead; a load that found nothing can be asked again", async () => {
    const live = { ...STALE, stale: false, asOfEpochMs: Date.UTC(2026, 9, 23) };
    let answer: ModelSuggestions | undefined = undefined;
    const host = suggestionsHost(() => Promise.resolve(answer));
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    h.byId("rh-openai-model-suggestions").fire("popupshowing");
    await flush();
    expect(
      h.byId("rh-openai-models-status").getAttribute("data-l10n-id"),
    ).toBeNull();
    answer = live;
    h.byId("rh-openai-model-suggestions").fire("popupshowing");
    await flush();
    await flush();
    expect(host.asked).toHaveLength(2);
    expect(h.byId("rh-openai-models-status").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.modelsAsOf,
    );
  });

  it("picking a suggestion types it into the bound model field and fires input and change; a typed ID is left alone", async () => {
    const host = suggestionsHost(() => Promise.resolve(STALE));
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    const input = h.byId("rh-anthropic-model");
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    // A typed model ID no list offers is the user's to keep.
    input.value = "claude-typed-by-hand";
    const menu = h.byId("rh-anthropic-model-suggestions");
    menu.value = "";
    menu.fire("command");
    expect(input.value).toBe("claude-typed-by-hand");
    expect(events).toEqual([]);
    menu.fire("popupshowing");
    await flush();
    await flush();
    menu.value = "anthropic-bundled-b";
    menu.fire("command");
    expect(input.value).toBe("anthropic-bundled-b");
    expect(events).toEqual(["input", "change"]);
    expect(menu.value).toBe("");
  });

  it("builds the price table into the providers group: lists rows, saves for the chosen provider, says why a save failed, removes", async () => {
    const rows: PriceRow[] = [
      {
        providerId: "openai",
        modelId: "gpt-rhsyn",
        inputPerMTokUsd: 2,
        outputPerMTokUsd: 12,
        cachedInputPerMTokUsd: 0.2,
        asOfEpochMs: Date.UTC(2026, 9, 1),
      },
    ];
    const saves: PriceInput[] = [];
    let answer: PriceSaveResult = { saved: false, reason: "invalid" };
    const host = Object.assign(fakeHost({ activeProvider: "gemini" }), {
      listPrices: () => Promise.resolve([...rows]),
      savePrice: (input: PriceInput) => {
        saves.push(input);
        return Promise.resolve(answer);
      },
      deletePrice: (provider: string, modelId: string) => {
        rows.splice(
          rows.findIndex(
            (r) => r.providerId === provider && r.modelId === modelId,
          ),
          1,
        );
        return Promise.resolve(true);
      },
    });
    const h = paneHarness({ host });
    await h.controller.init(h.root);
    const logic = h.controller.logic as Logic;
    const group = h.byId("rh-prefs-providers");
    expect(group.children.map((c) => c.id)).toContain("rh-prefs-prices");
    const list = h.byId("rh-prefs-price-rows");
    expect(list.children).toHaveLength(1);
    const line = list.children[0]!.children[0]!;
    expect(line.getAttribute("data-l10n-id")).toBe(PREFERENCES_L10N.priceRow);
    expect(JSON.parse(line.getAttribute("data-l10n-args")!)).toEqual({
      provider: "OpenAI",
      model: "gpt-rhsyn",
      input: "2",
      output: "12",
      cached: "0.2",
      date: logic.formatDate(Date.UTC(2026, 9, 1)),
    });
    expect(h.byId("rh-prefs-price-model").getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.priceModel,
    );

    h.byId("rh-provider").value = "gemini";
    h.byId("rh-prefs-price-model").value = "gemini-rhsyn";
    h.byId("rh-prefs-price-input").value = "0.3";
    h.byId("rh-prefs-price-output").value = "2.5";
    h.byId("rh-prefs-price-as-of").value = "2026-10-23";
    h.byId("rh-prefs-price-save").fire("click");
    await flush();
    expect(saves).toEqual([
      {
        provider: "gemini",
        modelId: "gemini-rhsyn",
        input: "0.3",
        output: "2.5",
        cached: "",
        asOf: "2026-10-23",
      },
    ]);
    const status = h.byId("rh-prefs-price-status");
    expect(status.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.priceInvalid,
    );
    // A refused value stays in the field.
    expect(h.byId("rh-prefs-price-model").value).toBe("gemini-rhsyn");
    const outcomes: [PriceSaveResult, string][] = [
      [{ saved: false, reason: "refused" }, PREFERENCES_L10N.priceRefused],
      [
        { saved: false, reason: "unavailable" },
        PREFERENCES_L10N.priceUnavailable,
      ],
      [{ saved: true }, PREFERENCES_L10N.priceSaved],
    ];
    for (const [result, id] of outcomes) {
      answer = result;
      h.byId("rh-prefs-price-save").fire("click");
      await flush();
      await flush();
      expect(status.getAttribute("data-l10n-id")).toBe(id);
    }
    expect(h.byId("rh-prefs-price-model").value).toBe("");

    list.children[0]!.children[1]!.fire("click");
    await flush();
    await flush();
    expect(rows).toEqual([]);
    expect(list.children).toHaveLength(0);
    expect(status.getAttribute("data-l10n-id")).toBe(
      PREFERENCES_L10N.priceRemoved,
    );
  });

  it("a row with no cached price uses the shorter line; with no host the form is disabled", async () => {
    const h = paneHarness({});
    await h.controller.init(h.root);
    expect(h.byId("rh-prefs-price-save").disabled).toBe(true);
    expect(h.byId("rh-prefs-price-model").disabled).toBe(true);
    const message = (h.controller.logic as Logic).priceMessage(
      {
        providerId: "anthropic",
        modelId: "m",
        inputPerMTokUsd: 1,
        outputPerMTokUsd: 5,
        asOfEpochMs: 0,
      },
      { anthropic: "Anthropic" },
      h.controller.l10n,
    );
    expect(message.id).toBe(PREFERENCES_L10N.priceRowNoCached);
    expect(message.args).not.toHaveProperty("cached");
  });

  it("agrees with the TypeScript side: Test credentials, provider ids, names, and no built id collides with the markup", () => {
    const h = paneHarness({});
    const spec = h.controller.spec as unknown as {
      providerCredentials: Record<string, string>;
      providerNames: Record<string, string>;
      built: Record<string, string>;
    };
    expect(spec.providerCredentials).toEqual(
      Object.fromEntries(LLM_CREDENTIALS.map((c) => [c.provider, c.id])),
    );
    for (const [provider, name] of Object.entries(spec.providerNames)) {
      expect(name).toBe(ftlValue(`research-helper-provider-${provider}`));
    }
    const markupIds = new Set(
      [...XHTML_CODE.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!),
    );
    const suffixes = [spec.built.suggestions!, spec.built.modelsStatus!];
    const builtIds = [
      ...Object.values(spec.built).filter((v) => !suffixes.includes(v)),
      ...LLM_CREDENTIALS.flatMap(({ elementPrefix }) =>
        suffixes.map((suffix) => `${elementPrefix}${suffix}`),
      ),
    ];
    for (const id of builtIds) expect(markupIds.has(id), id).toBe(false);
    expect(markupIds.has("rh-prefs-providers")).toBe(true);
  });

  it("every P3-T14 string is in the en-US bundle and, owner-reviewed (2026-10-25, G-41), in ko-KR", () => {
    expect(P3T14_IDS).toHaveLength(20);
    for (const id of P3T14_IDS) {
      expect(FTL, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(KO_FTL, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(KO_FTL, id).not.toMatch(new RegExp(`^# ${id} =`, "m"));
    }
    // docs/09 §2.3's wording: a 429 is a pass, and the line says so.
    expect(ftlValue(PREFERENCES_L10N.testOkRateLimited)).toContain("HTTP 429");
  });

  it("item 279(a) and (d): the out-of-credit line and the key-present line, in en-US and, owner-reviewed, in ko-KR", () => {
    // The owner's wording (plan/00 §6 item 279(a)), with the time placed.
    expect(ftlValue(PREFERENCES_L10N.testOkNoCredit)).toBe(
      "Key accepted, but the account has no credit left · checked { $time }",
    );
    expect(KO_FTL).toMatch(
      new RegExp(`^${PREFERENCES_L10N.testOkNoCredit} =`, "m"),
    );
    expect(KO_FTL).not.toMatch(
      new RegExp(`^# ${PREFERENCES_L10N.testOkNoCredit} =`, "m"),
    );
    // Item 279(d): results are stored now, so "this session" is gone.
    expect(ftlValue(PREFERENCES_L10N.keyPresent)).toBe(
      "A key is stored. Not tested yet.",
    );
    expect(NO_CREDIT_MESSAGE_KEY).toBe(
      new QuotaExceededError(402, "x", {}).messageKey,
    );
  });
});

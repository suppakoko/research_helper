import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import {
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  RateLimitError,
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
import { PREFS } from "../../../src/prefs/schema";
import {
  MIN_DIGEST_KEY_LENGTH,
  NCBI_TEST_PMID,
  NCBI_TEST_URL,
  OS_KEYSTORE_PREF_VALUE,
  PREFERENCES_L10N,
  PREFERENCES_PANE_ID,
  PREFERENCES_PANE_SCRIPT,
  PREFERENCES_PANE_SRC,
  PREFERENCES_ROOT_ID,
  SEMANTIC_SCHOLAR_RETRY_DELAY_MS,
  SEMANTIC_SCHOLAR_TEST_URL,
  SOURCE_CREDENTIALS,
  backendBadge,
  classifyFailure,
  classifyNcbiResponse,
  classifySemanticScholarResponse,
  createPreferencesHost,
  isPaneCredential,
  keyDigest,
  ncbiTestRequest,
  normalizeKeyInput,
  preferencePaneOptions,
  semanticScholarTestRequest,
  type TestReport,
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
}

function hostHarness(
  respond: (request: HttpRequest, attempt: number) => Promise<HttpResponse>,
  options: {
    readonly secrets?: SecretStore | undefined;
    backend?: string;
  } = {},
): HostHarness {
  const store = memoryStore();
  const requests: HttpRequest[] = [];
  const sink = recordingSink();
  const clock = createManualClock(1_760_000_000_000);
  const host = createPreferencesHost({
    secrets: "secrets" in options ? options.secrets : store,
    request: (request) => {
      requests.push(request);
      return respond(request, requests.length);
    },
    getBackendPref: () => options.backend ?? OS_KEYSTORE_PREF_VALUE,
    clock,
    logger: createLogger({ sink, clock, level: "debug" }),
  });
  return { store, requests, sink, clock, host };
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

  it("holds exactly the two literature-source credentials and refuses every other id", () => {
    expect(SOURCE_CREDENTIALS.map((entry) => entry.id)).toEqual([
      "source.ncbi",
      "source.semanticscholar",
    ]);
    for (const id of SECRET_IDS) {
      expect(isPaneCredential(id)).toBe(
        id === "source.ncbi" || id === "source.semanticscholar",
      );
    }
    expect(isPaneCredential("llm.openai")).toBe(false);
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
  it("uses docs/07 §8.5's spelling of the tier-1 preference value", () => {
    expect(PREFS.secretBackend.values).toContain(OS_KEYSTORE_PREF_VALUE);
    expect(OS_KEYSTORE_PREF_VALUE).toBe("oskeystore");
  });

  it("names the operating-system store on Windows and macOS, and allows storing", () => {
    expect(backendBadge("oskeystore", "win")).toEqual({
      state: "windows",
      messageId: PREFERENCES_L10N.backendWindows,
      warning: false,
      canStore: true,
    });
    expect(backendBadge("oskeystore", "mac")).toEqual({
      state: "mac",
      messageId: PREFERENCES_L10N.backendMac,
      warning: false,
      canStore: true,
    });
  });

  it("does not claim 'System keyring' on Linux, because the probe cannot tell it from NSSKeyStore (P1-T41)", () => {
    const badge = backendBadge("oskeystore", "linux");
    expect(badge.state).toBe("indeterminate");
    expect(badge.warning).toBe(true);
    expect(badge.canStore).toBe(true);
    expect(badge.messageId).toBe(PREFERENCES_L10N.backendIndeterminate);
    expect(backendBadge("oskeystore", "other").state).toBe("indeterminate");
  });

  it("says plainly that nothing is available, and refuses to store, when the probe did not record tier 1", () => {
    for (const value of ["", "session", "passphrase", "garbage"]) {
      for (const platform of ["win", "mac", "linux", "other"] as const) {
        const badge = backendBadge(value, platform);
        expect(badge).toEqual({
          state: "unavailable",
          messageId: PREFERENCES_L10N.backendUnavailable,
          warning: true,
          canStore: false,
        });
      }
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
    const cases: unknown[] = [
      new UpstreamServerError(503, "HTTP 503", {}),
      new NetworkError("boom", {}),
      new Error("anything"),
      "a string",
      undefined,
    ];
    for (const error of cases) {
      for (const id of ["source.ncbi", "source.semanticscholar"] as const) {
        expect(classifyFailure(id, error)).toEqual({
          outcome: "inconclusive",
          reason: "request-failed",
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
    expect(state.credentials).toEqual([
      { id: "source.ncbi", present: true, lastTest: undefined },
      { id: "source.semanticscholar", present: false, lastTest: undefined },
    ]);

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
    await expect(h.host.storeKey("llm.openai", syntheticKey())).rejects.toThrow(
      RangeError,
    );
    await expect(h.host.testKey("nonsense")).rejects.toThrow(RangeError);
    await expect(h.host.clearKey("tts.gemini")).rejects.toThrow(RangeError);
    expect(h.store.values.size).toBe(0);
  });

  it("Remove all clears every stored SecretId, not only the pane's two, and reports the count", async () => {
    const h = hostHarness(() => Promise.reject(new Error("unused")));
    await h.store.set("llm.openai", syntheticKey());
    await h.host.storeKey("source.ncbi", syntheticKey());
    await h.host.storeKey("source.semanticscholar", syntheticKey(40));
    expect(await h.host.clearAllKeys()).toBe(3);
    expect(h.store.values.size).toBe(0);
    expect(await h.host.clearAllKeys()).toBe(0);
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

/* ------------------------------------------------------- 10. the markup rules */

describe("P1-T44 — the fragment carries the markup rules", () => {
  const keyInputs = [...XHTML_CODE.matchAll(/<html:input\b[^>]*>/g)].map(
    (m) => m[0],
  );

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
    expect(keyInputs).toHaveLength(SOURCE_CREDENTIALS.length);
    for (const input of keyInputs) {
      expect(input).toMatch(/type="password"/);
      expect(input).not.toMatch(/\bpreference=/);
      expect(input).toMatch(/class="rh-key"/);
      expect(input).toMatch(/autocomplete="off"/);
    }
    // No `preference=` anywhere in this pane at all, yet: the only bindings it
    // may ever carry are non-secret rows, and this card adds none.
    expect(XHTML_CODE).not.toMatch(/\bpreference="/);
  });

  it("rule 1: a reveal button per field, labelled as hold-to-show, and no sticky toggle", () => {
    for (const { elementPrefix } of SOURCE_CREDENTIALS) {
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
    for (const { elementPrefix } of SOURCE_CREDENTIALS) {
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

class FakeElement {
  readonly listeners = new Map<string, Handler[]>();
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  type = "";
  value = "";
  placeholder = "";
  disabled = false;
  textContent = "";
  constructor(readonly id: string) {}
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
  spec: { root: string; credentials: Record<string, string> };
  l10n: Record<string, string>;
  OS_KEYSTORE: string;
  host: Record<string, unknown> | null;
  logic: {
    badge: (
      pref: string,
      platform: string,
      ctx: unknown,
    ) => { messageId: string; warning: boolean; canStore: boolean };
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
  for (const id of ids) index.set(id, new FakeElement(id));
  const docListeners = new Map<string, Handler[]>();
  const l10nCalls: PaneHarness["l10nCalls"] = [];
  const debugLines: string[] = [];
  const doc = {
    getElementById: (id: string) => index.get(id) ?? null,
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
  const win = { setTimeout: (fn: () => void) => fn() };
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
  present?: Partial<Record<string, boolean>>;
  test?: (id: string) => Promise<TestReport>;
}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const present: Record<string, boolean> = {
    "source.ncbi": false,
    "source.semanticscholar": false,
    ...options.present,
  };
  const host = {
    paneId: PREFERENCES_PANE_ID,
    calls,
    readState: () => {
      calls.push({ method: "readState", args: [] });
      return Promise.resolve({
        backendPref: OS_KEYSTORE_PREF_VALUE,
        storeAvailable: options.storeAvailable ?? true,
        credentials: Object.entries(present).map(([id, isPresent]) => ({
          id,
          present: isPresent,
          lastTest: undefined,
        })),
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
    expect(h.controller.spec.credentials).toEqual(
      Object.fromEntries(
        SOURCE_CREDENTIALS.map((c) => [c.id, c.elementPrefix]),
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
      for (const pref of ["oskeystore", "", "session"]) {
        const expected = backendBadge(pref, platform as "win");
        const actual = h.controller.logic.badge(pref, platform, h.controller);
        expect(actual.messageId).toBe(expected.messageId);
        expect(actual.warning).toBe(expected.warning);
        expect(actual.canStore).toBe(expected.canStore);
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

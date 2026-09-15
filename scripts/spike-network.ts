/**
 * P0-T15 (spike V-7) — throwaway network probe, run by the owner from Zotero's
 * Tools → Developer → Run JavaScript window.
 *
 * `docs/11` §4.2 V-7 asks whether the Zotero process can issue cross-origin
 * POSTs with custom headers and receive full responses. **This version covers
 * OpenRouter and one keyless PubMed request only**; OpenAI, Anthropic and
 * Gemini are the rest of the card and are not here.
 *
 * It goes through the real `src/core/http/client.ts`, so the run also
 * exercises docs/07 §7.4's option set and the exception mapping inside Zotero.
 *
 * ## Producing the paste-ready block
 *
 * From the repository root:
 *
 * ```sh
 * npx tsx scripts/spike-network.ts | Set-Clipboard   # PowerShell
 * npx tsx scripts/spike-network.ts | clip            # cmd.exe
 * npx tsx scripts/spike-network.ts > probe.js        # anywhere, to inspect
 * ```
 *
 * Run under Node, this file reads its own source, cuts it at the
 * `NODE-ONLY BELOW THIS LINE` marker, bundles the part above with esbuild
 * (IIFE, global `RHSpikeNetwork`, target firefox140, ASCII-only) and prints
 * plain JavaScript to stdout, followed by the one `return await …main(…)`
 * line that Run JavaScript's async mode needs. Nothing is written to disk and
 * none of the Node-side code reaches the block. esbuild is not a direct
 * dependency; it is the one `tsx` and `zotero-plugin-scaffold` already pull
 * in.
 *
 * ## What Run JavaScript actually does (read from Zotero 10.0.2's omni.ja)
 *
 * `chrome/content/zotero/runJS.js`: with "Run as async function" checked the
 * editor text is wrapped as `'(async function () {' + code + '})()'` and passed
 * to `Zotero.getMainWindow().eval()`; a string result is shown verbatim in the
 * Result box. Typing or pasting text containing `await ` ticks the checkbox
 * automatically. The code is **not persisted** anywhere — no pref, no storage;
 * it lives in the editor until the window closes. The key is still asked for
 * through a dialog, because text in the editor is on screen, in the clipboard
 * (and Windows clipboard history) when pasted, and one careless copy away from
 * a bug report.
 *
 * Because the code runs in the *main window's* global, `console`,
 * `performance` and `AbortController` may well exist there; this probe uses
 * none of them anyway, since the plugin sandbox has none (docs/01 §2.3).
 *
 * ## The key
 *
 * Asked for at run time with `Services.prompt.promptPassword(parent, title,
 * text, { value })` — Gecko 140's 4-argument form (`Prompter.sys.mjs`; the old
 * checkbox arguments are gone). The dialog's OK button is labelled "Sign in"
 * (Gecko's own `SignIn` string). The key is held in a local variable for the
 * one request, is never written to a pref, a file or the debug log, and every
 * output line is passed through a redactor that replaces the literal key
 * before it is shown or logged. The `Authorization` header is only ever
 * reported as present/absent and whether it matches what was typed.
 *
 * ## Output
 *
 * One summary, returned as the evaluation result (the Result box) and also
 * written line by line to `Zotero.debug` with the prefix
 * `[research_helper P0-T15]` (Help → Debug Output Logging → View Output, only
 * if logging was enabled before the run).
 */

import {
  createHttpClient,
  HttpError,
  type HttpClient,
  type HttpResponse,
  type HttpTransport,
  type HttpTransportXhr,
} from "../src/core/http/client";
import {
  buildUserAgent,
  ncbiIdentityParams,
  PROJECT_URL,
  TOOL_NAME,
} from "../src/core/http/userAgent";

// ---------------------------------------------------------------------------
// Compile-time: `Zotero.HTTP` (zotero-types + typings/zotero-augment.d.ts)
// satisfies the client's port, so the composition root needs no cast.
// ---------------------------------------------------------------------------

/** Never called: it exists so `tsc` proves the assignment compiles. */
export function zoteroHttpIsPort(http: _ZoteroTypes.HTTP): HttpTransport {
  return http;
}

// ---------------------------------------------------------------------------
// Configuration — every value cites the section that owns it
// ---------------------------------------------------------------------------

/** docs/03 §5.1. */
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * Models `docs/03` names, as OpenRouter slugs (§9.4's author-prefix rule;
 * Anthropic's dotted minor version). The probe does **not** trust this list's
 * prices or even the slugs' existence: it reads the public catalogue
 * (`GET /api/v1/models`, §5.1, §9.4) and picks the cheapest suitable entry by
 * *live* price, as `plan/README.md` §5 rule 4 requires. The last entry is the
 * `openrouter.model` seed default (docs/07 §8.5), used alone if the catalogue
 * cannot be read.
 */
const CANDIDATE_SLUGS: readonly string[] = [
  "openai/gpt-5.6-luna", // docs/03 §2.5, §16
  "google/gemini-3.1-flash-lite", // docs/03 §4.6 "Cheapest"
  "google/gemini-3.5-flash-lite", // docs/03 §4.6
  "google/gemini-3.8-flash", // docs/03 §5.3, §16
  "anthropic/claude-haiku-4.5", // docs/03 §9.4, §16
  "anthropic/claude-sonnet-5", // docs/07 §8.5 seed default
];

/** Output cap. Small; a non-reasoning model needs 1–2 tokens for "pong". */
const MAX_TOKENS = 32;

/** Rough prompt size incl. chat-template overhead, for the estimate only. */
const PROMPT_TOKENS_ESTIMATE = 40;

/** At most this many POST attempts; only an HTTP 404 (unroutable) moves on. */
const MAX_COMPLETION_ATTEMPTS = 3;

const PROMPT_TEXT = "Reply with exactly one word: pong";

/** docs/02 §3.3 example (a), verbatim parameters. */
const PUBMED_ESEARCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

/** Characters of a response body quoted in the summary. */
const EXCERPT_CHARS = 700;

// ---------------------------------------------------------------------------
// Environment handed in by the paste block's last line
// ---------------------------------------------------------------------------

export interface ProbeEnv {
  readonly zotero: {
    readonly version: string;
    readonly HTTP: HttpTransport;
    debug(message: string): void;
  };
  readonly services: Pick<JSServices, "prompt" | "wm">;
  /** `Ci` / `Components.interfaces`, for reading back the sent headers. */
  readonly interfaces: unknown;
  /** package.json `version` at emit time; goes into the D10 User-Agent. */
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export async function main(env: ProbeEnv): Promise<string> {
  const lines: string[] = [];
  const secrets: string[] = [];
  const say = (line = ""): void => {
    const safe = redact(line, secrets);
    lines.push(safe);
    try {
      env.zotero.debug(`[research_helper P0-T15] ${safe}`);
    } catch {
      /* the summary still comes back as the result */
    }
  };

  try {
    const userAgent = buildUserAgent(env.version);
    say("research_helper P0-T15 network probe (V-7) - OpenRouter + PubMed");
    say(`run at      ${new Date().toISOString()}`);
    say(`zotero      ${env.zotero.version}`);
    say(`user-agent  ${userAgent}`);
    say("client      src/core/http/client.ts (anon, successCodes:false,");
    say("            noRetryOnThrottle, errorDelayMax:0, logBodyLength:0)");

    const key = askForKey(env);
    if (key !== null) secrets.push(key);
    say(
      key === null
        ? "key         none entered (dialog cancelled or empty)"
        : `key         entered via password dialog (${key.length} chars; never shown)`,
    );

    const probe = instrument(env.zotero.HTTP);
    const client = createHttpClient({ transport: probe.transport, userAgent });

    say();
    const ranked = await readCatalogue(client, say);

    say();
    const orVerdict =
      key === null
        ? "NOT RUN - no key entered"
        : await chatCompletion(client, probe, env.interfaces, key, ranked, say);

    say();
    const pmVerdict = await pubmed(client, probe, env.interfaces, say);

    say();
    say(`VERDICT OpenRouter POST + custom headers: ${orVerdict}`);
    say(`VERDICT PubMed E-utilities (keyless):     ${pmVerdict}`);
  } catch (e) {
    say(`PROBE ABORTED: ${describeError(e)}`);
  }
  return lines.join("\n");
}

function askForKey(env: ProbeEnv): string | null {
  const pass = { value: "" };
  // Parent the dialog on the Run JavaScript window so it opens in front of
  // it; a null parent is accepted by the prompt service.
  const parent = env.services.wm.getMostRecentWindow("zotero:run-js");
  const ok = env.services.prompt.promptPassword(
    parent,
    `${TOOL_NAME} - P0-T15 network probe`,
    "Enter your OpenRouter API key.\n\n" +
      "It is used for one tiny chat completion (estimated well under " +
      "US$0.001), then discarded. It is not stored, logged or displayed.\n\n" +
      "Cancel skips the OpenRouter request; PubMed still runs.",
    pass,
  );
  const key = ok ? pass.value.trim() : "";
  pass.value = "";
  return key === "" ? null : key;
}

// --- OpenRouter catalogue --------------------------------------------------

interface RankedModel {
  readonly slug: string;
  /** USD per token, from the live catalogue; null when unknown. */
  readonly promptUsd: number | null;
  readonly completionUsd: number | null;
  readonly estimateUsd: number | null;
}

async function readCatalogue(
  client: HttpClient,
  say: (line?: string) => void,
): Promise<readonly RankedModel[]> {
  const url = `${OPENROUTER_BASE}/models`;
  const seed: RankedModel = {
    slug: CANDIDATE_SLUGS[CANDIDATE_SLUGS.length - 1] ?? "",
    promptUsd: null,
    completionUsd: null,
    estimateUsd: null,
  };
  say(`[1] OpenRouter GET ${url} (public catalogue, no auth)`);

  const x = await timed(() =>
    client.request("GET", url, { timeoutMs: 60_000 }),
  );
  if (!x.response) {
    say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
    say(`    falling back to the docs/07 §8.5 seed default ${seed.slug}`);
    return [seed];
  }
  const r = x.response;
  const doc = parseJson(r.body);
  const data = arr(at(doc, "data"));
  say(
    `    status ${r.status}, ${x.ms} ms, ${r.body.length} chars, ` +
      `complete JSON: ${doc === undefined ? "NO" : "yes"}, models: ${data.length}`,
  );
  if (r.status !== 200 || data.length === 0) {
    say(`    body: ${excerpt(r.body)}`);
    say(`    falling back to the docs/07 §8.5 seed default ${seed.slug}`);
    return [seed];
  }

  const bySlug = new Map<string, unknown>();
  for (const m of data) {
    const id = str(at(m, "id"));
    if (id !== null) bySlug.set(id, m);
  }

  const usable: (RankedModel & { reasoningByDefault: boolean })[] = [];
  for (const slug of CANDIDATE_SLUGS) {
    const m = bySlug.get(slug);
    if (m === undefined) {
      say(`    - ${slug}: not in catalogue`);
      continue;
    }
    const promptUsd = Number(str(at(m, "pricing", "prompt")) ?? NaN);
    const completionUsd = Number(str(at(m, "pricing", "completion")) ?? NaN);
    const params = at(m, "supported_parameters");
    const mandatory = at(m, "reasoning", "mandatory") === true;
    const byDefault = at(m, "reasoning", "default_enabled") === true;
    const price = `$${perMillion(promptUsd)}/$${perMillion(completionUsd)} per 1M`;
    let reject = "";
    if (!(promptUsd > 0 && completionUsd > 0)) reject = "price missing or zero";
    else if (mandatory) reject = "reasoning mandatory (would eat max_tokens)";
    else if (Array.isArray(params) && !params.includes("max_tokens")) {
      reject = "max_tokens unsupported";
    }
    say(
      `    - ${slug}: ${price}` +
        `${byDefault ? ", reasoning on by default" : ""}` +
        `${reject ? ` -> skipped: ${reject}` : ""}`,
    );
    if (reject) continue;
    usable.push({
      slug,
      promptUsd,
      completionUsd,
      estimateUsd:
        PROMPT_TOKENS_ESTIMATE * promptUsd + MAX_TOKENS * completionUsd,
      reasoningByDefault: byDefault,
    });
  }

  usable.sort(
    (a, b) =>
      Number(a.reasoningByDefault) - Number(b.reasoningByDefault) ||
      (a.estimateUsd ?? 0) - (b.estimateUsd ?? 0),
  );
  if (usable.length === 0) {
    say(`    no suitable candidate; using seed default ${seed.slug}`);
    return [seed];
  }
  say(
    `    order: ${usable.map((u) => u.slug).join(", ")} ` +
      `(non-reasoning first, then live price)`,
  );
  return usable;
}

// --- OpenRouter chat completion ---------------------------------------------

async function chatCompletion(
  client: HttpClient,
  probe: Instrumented,
  interfaces: unknown,
  key: string,
  ranked: readonly RankedModel[],
  say: (line?: string) => void,
): Promise<string> {
  const url = `${OPENROUTER_BASE}/chat/completions`;
  let verdict = "FAIL - no attempt made";

  for (const [i, model] of ranked.slice(0, MAX_COMPLETION_ATTEMPTS).entries()) {
    // docs/03 §5.2 + §14.2 headers; X-OpenRouter-Metadata per §5.2 makes the
    // response carry `openrouter_metadata`, which proves a non-auth custom
    // header reached OpenRouter.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": PROJECT_URL,
      "X-Title": TOOL_NAME,
      "X-OpenRouter-Title": TOOL_NAME,
      "X-OpenRouter-Metadata": "enabled",
    };
    // docs/03 §5.3 minimal request; `provider.data_collection: "deny"` is D6.
    const body = JSON.stringify({
      model: model.slug,
      messages: [{ role: "user", content: PROMPT_TEXT }],
      max_tokens: MAX_TOKENS,
      provider: {
        require_parameters: true,
        data_collection: "deny",
        sort: "price",
      },
    });

    say(`[2.${i + 1}] OpenRouter POST ${url}`);
    say(`    model ${model.slug}, max_tokens ${MAX_TOKENS}, body ${body}`);
    if (model.estimateUsd !== null) {
      say(
        `    estimated cost <= $${model.estimateUsd.toFixed(6)} (live catalogue price)`,
      );
    }

    const x = await timed(() =>
      client.request("POST", url, { headers, body, timeoutMs: 120_000 }),
    );
    reportSentHeaders(probe.last(), interfaces, key, say, [
      "User-Agent",
      "Content-Type",
      "HTTP-Referer",
      "X-Title",
      "X-OpenRouter-Title",
      "X-OpenRouter-Metadata",
    ]);

    if (!x.response) {
      say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
      return `FAIL - ${describeError(x.error)}`;
    }
    const r = x.response;
    const doc = parseJson(r.body);
    say(
      `    status ${r.status}, ${x.ms} ms, ${r.body.length} chars, ` +
        `complete JSON: ${doc === undefined ? "NO" : "yes"}, ` +
        `content-type ${r.header("content-type") ?? "-"}`,
    );

    if (r.status !== 200) {
      const message = str(at(doc, "error", "message"));
      say(`    error.message: ${message ?? "-"}`);
      say(`    error.code:    ${String(at(doc, "error", "code") ?? "-")}`);
      say(`    body: ${excerpt(r.body)}`);
      verdict =
        r.status === 401
          ? "FAIL - HTTP 401: Authorization rejected (key invalid or header dropped)"
          : `FAIL - HTTP ${r.status}: ${message ?? "see body"}`;
      if (r.status === 404) continue; // unroutable under deny; not billed
      return verdict;
    }

    const content = str(at(doc, "choices", 0, "message", "content"));
    const finish = str(at(doc, "choices", 0, "finish_reason"));
    const cost = at(doc, "usage", "cost");
    const hasMetadata = at(doc, "openrouter_metadata") !== undefined;
    say(`    served by model ${str(at(doc, "model")) ?? "-"}`);
    say(
      `    finish_reason ${finish ?? "-"}, content ${JSON.stringify(content)}`,
    );
    say(
      `    usage: prompt ${String(at(doc, "usage", "prompt_tokens") ?? "-")}, ` +
        `completion ${String(at(doc, "usage", "completion_tokens") ?? "-")}, ` +
        `cost $${String(cost ?? "-")} (OpenRouter-reported spend)`,
    );
    say("    Authorization accepted: yes (HTTP 200, not 401)");
    say(
      `    X-OpenRouter-Metadata arrived: ${
        hasMetadata
          ? "yes (openrouter_metadata present in response)"
          : "not evidenced (openrouter_metadata absent)"
      }`,
    );
    say(
      "    HTTP-Referer / X-Title arrival: check openrouter.ai/activity " +
        "(App column should read research_helper)",
    );
    say(`    body: ${excerpt(r.body)}`);
    const error = at(doc, "error");
    return error === undefined && content !== null
      ? `PASS - HTTP 200, finish_reason ${finish ?? "-"}, cost $${String(cost ?? "?")}`
      : `FAIL - HTTP 200 but no completion (${excerpt(JSON.stringify(error ?? null), 120)})`;
  }
  return verdict;
}

// --- PubMed -----------------------------------------------------------------

async function pubmed(
  client: HttpClient,
  probe: Instrumented,
  interfaces: unknown,
  say: (line?: string) => void,
): Promise<string> {
  const { tool, email } = ncbiIdentityParams();
  const query = new URLSearchParams({
    db: "pubmed",
    term: "CRISPR base editing",
    reldate: "1095",
    datetype: "edat",
    retmax: "5",
    retmode: "json",
    tool,
    email,
  });
  const url = `${PUBMED_ESEARCH}?${query.toString()}`;
  say(`[3] PubMed GET ${url}`);

  const x = await timed(() =>
    client.request("GET", url, {
      headers: { Accept: "application/json" },
      timeoutMs: 30_000,
    }),
  );
  reportSentHeaders(probe.last(), interfaces, null, say, ["User-Agent"]);
  if (!x.response) {
    say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
    return `FAIL - ${describeError(x.error)}`;
  }
  const r = x.response;
  const doc = parseJson(r.body);
  const count = str(at(doc, "esearchresult", "count"));
  const ids = arr(at(doc, "esearchresult", "idlist"));
  const backendError = at(doc, "esearchresult", "ERROR");
  say(
    `    status ${r.status}, ${x.ms} ms, ${r.body.length} chars, ` +
      `complete JSON: ${doc === undefined ? "NO" : "yes"}`,
  );
  say(
    `    X-RateLimit-Limit ${r.header("x-ratelimit-limit") ?? "-"}, ` +
      `X-RateLimit-Remaining ${r.header("x-ratelimit-remaining") ?? "-"}`,
  );
  say(`    count ${count ?? "-"}, idlist ${JSON.stringify(ids)}`);
  if (backendError !== undefined)
    say(`    esearchresult.ERROR ${String(backendError)}`);
  say(`    body: ${excerpt(r.body)}`);
  return r.status === 200 && count !== null && backendError === undefined
    ? `PASS - HTTP 200, count ${count}, ${ids.length} ids`
    : `FAIL - HTTP ${r.status}${backendError !== undefined ? ", esearchresult.ERROR" : ""}`;
}

// --- Instrumentation ----------------------------------------------------------

interface Instrumented {
  readonly transport: HttpTransport;
  /** The XHR of the most recent request that resolved, if any. */
  last(): HttpTransportXhr | undefined;
}

/** Wrap `Zotero.HTTP` to keep the last XHR, so sent headers can be read back. */
function instrument(http: HttpTransport): Instrumented {
  let last: HttpTransportXhr | undefined;
  return {
    transport: {
      async request(method, url, options) {
        last = undefined;
        last = await http.request(method, url, options);
        return last;
      },
      UnexpectedStatusException: http.UnexpectedStatusException,
      TimeoutException: http.TimeoutException,
      BrowserOfflineException: http.BrowserOfflineException,
      SecurityException: http.SecurityException,
      CancelledException: http.CancelledException,
    },
    last: () => last,
  };
}

/**
 * Report the request headers as Gecko's channel holds them after the request,
 * i.e. what was actually put on the wire rather than what we asked for.
 * `Authorization` is reported as present/absent and whether it equals
 * `Bearer <typed key>` — never its value. `Cookie` should be absent (`anon`).
 */
function reportSentHeaders(
  xhr: HttpTransportXhr | undefined,
  interfaces: unknown,
  key: string | null,
  say: (line?: string) => void,
  names: readonly string[],
): void {
  const read = channelHeaderReader(xhr, interfaces);
  if (typeof read === "string") {
    say(`    sent headers: unavailable (${read})`);
    return;
  }
  for (const name of names)
    say(`    sent ${name}: ${read(name) ?? "(absent)"}`);
  if (key !== null) {
    const auth = read("Authorization");
    say(
      `    sent Authorization: ${
        auth === undefined
          ? "(absent)"
          : `present, equals "Bearer <typed key>": ${auth === `Bearer ${key}` ? "yes" : "NO"}`
      }`,
    );
  }
  say(
    `    sent Cookie: ${read("Cookie") === undefined ? "(absent)" : "PRESENT"}`,
  );
}

function channelHeaderReader(
  xhr: HttpTransportXhr | undefined,
  interfaces: unknown,
): string | ((name: string) => string | undefined) {
  if (xhr === undefined) return "no XHR resolved";
  try {
    const channel = (xhr as unknown as { channel?: unknown }).channel;
    const iid = at(interfaces, "nsIHttpChannel");
    if (channel === null || typeof channel !== "object") return "no channel";
    if (iid === undefined) return "nsIHttpChannel not reachable";
    const http = (
      channel as { QueryInterface(iid: unknown): unknown }
    ).QueryInterface(iid) as { getRequestHeader(name: string): string };
    return (name) => {
      try {
        return http.getRequestHeader(name);
      } catch {
        return undefined; // NS_ERROR_NOT_AVAILABLE: header not set
      }
    };
  } catch (e) {
    return describeError(e);
  }
}

// --- Helpers -----------------------------------------------------------------

async function timed(
  run: () => Promise<HttpResponse>,
): Promise<{ ms: number; response?: HttpResponse; error?: unknown }> {
  const t0 = Date.now(); // docs/01 §2.3: no `performance` in the sandbox
  try {
    const response = await run();
    return { ms: Date.now() - t0, response };
  } catch (error) {
    return { ms: Date.now() - t0, error };
  }
}

function describeError(e: unknown): string {
  if (e instanceof HttpError) {
    return `HttpError code=${e.code} zoteroException=${e.source} message="${e.message}"`;
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  const message = at(e, "message");
  return typeof message === "string"
    ? `non-Error exception: ${message}`
    : `non-Error thrown: ${String(e)}`;
}

/**
 * Replace every typed secret, then anything shaped like a bearer credential
 * or an OpenRouter key (docs/09 §2.1's patterns, spelled with character
 * classes so the card's leak grep does not match this source file).
 */
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s !== "") out = out.split(s).join(`[redacted:${s.length}]`);
  }
  return out
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "$1 [redacted]")
    .replace(/\bsk[-]or[-]v1[-][A-Za-z0-9]{16,}/g, "[redacted]");
}

function excerpt(text: string, max = EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max
    ? flat
    : `${flat.slice(0, max)}... (+${flat.length - max} chars)`;
}

function perMillion(usdPerToken: number): string {
  return Number.isFinite(usdPerToken) ? (usdPerToken * 1e6).toFixed(2) : "?";
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function at(v: unknown, ...path: readonly (string | number)[]): unknown {
  let cur = v;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? (v as readonly unknown[]) : [];
}

// ---------------------------------------------------------------------------
// NODE-ONLY BELOW THIS LINE: the emitter. It is cut off before bundling, so
// none of it reaches the paste block.
// ---------------------------------------------------------------------------

const NODE_ONLY_MARKER = "// NODE-ONLY BELOW THIS LINE";

async function emitPasteBlock(scriptPath: string): Promise<void> {
  const { build } = await import("esbuild");
  const { readFileSync } = await import("node:fs");
  const { basename, dirname, join } = await import("node:path");

  const root = join(dirname(scriptPath), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  const version = typeof pkg.version === "string" ? pkg.version : "";
  buildUserAgent(version); // fail here, not in Zotero, on a bad version

  // The first occurrence is the marker comment above; everything from there
  // on (this emitter) is dropped, so the bundle is the probe alone.
  const source = readFileSync(scriptPath, "utf8");
  const cut = source.indexOf(NODE_ONLY_MARKER);
  if (cut < 0) throw new Error("node-only marker not found");

  const result = await build({
    stdin: {
      contents: source.slice(0, cut),
      loader: "ts",
      resolveDir: dirname(scriptPath),
      sourcefile: basename(scriptPath),
    },
    absWorkingDir: root,
    bundle: true,
    format: "iife",
    globalName: "RHSpikeNetwork",
    platform: "browser",
    target: "firefox140",
    charset: "ascii",
    legalComments: "none",
    write: false,
    logLevel: "warning",
  });
  const js = result.outputFiles[0]?.text;
  if (js === undefined) throw new Error("esbuild produced no output");

  // `charset: "ascii"` escapes strings and identifiers but not comments; make
  // the whole block ASCII so a trip through `clip` cannot mangle it.
  const ascii = js.replace(
    /[^\t\n\r -~]/g, // anything outside printable ASCII
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  process.stdout.write(
    [
      "// research_helper P0-T15 network probe (V-7): OpenRouter + PubMed only.",
      `// Generated ${new Date().toISOString()} from scripts/spike-network.ts, version ${version}.`,
      "// Tools > Developer > Run JavaScript: paste, make sure 'Run as async function'",
      "// is checked, press Run. A password dialog asks for the OpenRouter key.",
      "// Never type the key into this editor. Nothing here needs editing.",
      ascii.trimEnd(),
      "return await RHSpikeNetwork.main({",
      "  zotero: Zotero,",
      "  services: Services,",
      '  interfaces: typeof Ci !== "undefined" ? Ci : Components.interfaces,',
      `  version: ${JSON.stringify(version)},`,
      "});",
      "",
    ].join("\n"),
  );
}

const nodeScriptPath = process.argv[1];
if (nodeScriptPath === undefined) {
  process.stderr.write("spike-network: cannot determine the script path\n");
  process.exitCode = 1;
} else {
  emitPasteBlock(nodeScriptPath).catch((e: unknown) => {
    process.stderr.write(`spike-network: ${String(e)}\n`);
    process.exitCode = 1;
  });
}

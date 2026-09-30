/**
 * `P0-T15` / `P0-T16` / `P0-T17` — throwaway network probe, run by the owner
 * from Zotero's Tools → Developer → Run JavaScript window.
 *
 * One run answers three cards:
 *
 * - **`P0-T15`** (`V-7`) — cross-origin POSTs with custom headers. The
 *   OpenRouter and PubMed legs passed on 2026-09-15 and are kept verbatim so
 *   the owner can re-run everything at once; **OpenAI, Gemini and Anthropic
 *   direct** are the remainder and are new here.
 * - **`P0-T16`** (`V-8`) — SSE consumption, proved by *timestamps*: tokens
 *   arriving before the response completes, not merely a correct final text.
 * - **`P0-T17`** (`V-9`) — abortion of an in-flight request through
 *   `cancellerReceiver`, with how long after the abort the transfer really
 *   stops and whether the partial body survives.
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
 * it lives in the editor until the window closes. Keys are still asked for
 * through a dialog, because text in the editor is on screen, in the clipboard
 * (and Windows clipboard history) when pasted, and one careless copy away from
 * a bug report.
 *
 * ### …and why that matters for `P0-T16`'s answer
 *
 * Because the code runs in the **main window's global**, `console`,
 * `performance`, `AbortController` and `TextDecoderStream` may well exist
 * there. The *plugin sandbox* is a different global object, and `docs/01`
 * §2.3 records what it has, measured on Zotero 10.0.1 by `P0-T08`:
 * `AbortController`, `structuredClone`, `queueMicrotask`, `console` and
 * `performance` are **absent**. So this probe:
 *
 * - uses only globals the sandbox has (`setTimeout`, `TextDecoder`, `URL`,
 *   `Date.now()` — never `performance.now()`), and
 * - reports every measurement taken with a window-only global as
 *   `[main-window global only]`, with the sandbox answer named separately.
 *
 * A `fetch` result obtained here therefore does **not** settle whether the
 * sandbox's `fetch` (from its `wantGlobalProperties`, `docs/01` §8.4)
 * behaves the same; the `Zotero.HTTP` + `requestObserver` path does, because
 * `Zotero.HTTP` is the same object either way.
 *
 * ## The keys
 *
 * Asked for at run time with `Services.prompt.promptPassword(parent, title,
 * text, { value })` — Gecko 140's 4-argument form (`Prompter.sys.mjs`; the old
 * checkbox arguments are gone). **One dialog per provider, in the order
 * OpenRouter → OpenAI → Gemini → Anthropic; cancelling one skips that
 * provider's leg and the run continues.** A key is held in a local variable
 * for the duration of the run, is never written to a pref, a file or the
 * debug log, and every output line is passed through a redactor that replaces
 * the literal keys and `docs/09` §2.1's patterns before it is shown or
 * logged. `Authorization`, `x-api-key` and `x-goog-api-key` are only ever
 * reported as present/absent and whether they match what was typed.
 *
 * ## Output
 *
 * One summary, returned as the evaluation result (the Result box) and also
 * written line by line to `Zotero.debug` with the prefix
 * `[research_helper P0-T15/16/17]` (Help → Debug Output Logging → View
 * Output, only if logging was enabled before the run).
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
import {
  createSseParser,
  parseSse,
  type SseEvent,
} from "../src/llm/shared/sse";

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

/** The four providers, in the order their key dialogs appear. */
type ProviderId = "openrouter" | "openai" | "gemini" | "anthropic";

const PROVIDER_ORDER: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "gemini",
  "anthropic",
];

const PROVIDER_LABEL: Readonly<Record<ProviderId, string>> = {
  openrouter: "OpenRouter",
  openai: "OpenAI (direct)",
  gemini: "Google Gemini (direct)",
  anthropic: "Anthropic (direct)",
};

/** Base URLs. docs/03 §5.1, §2.1, §4.1, §3.1 respectively. */
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const ANTHROPIC_BASE = "https://api.anthropic.com";

/** docs/03 §3.2: required on every Anthropic request, and not a date to bump. */
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Models `docs/03` names, as OpenRouter slugs (§9.4's author-prefix rule;
 * Anthropic's dotted minor version). The probe does **not** trust this list's
 * prices or even the slugs' existence: it reads the public catalogue
 * (`GET /api/v1/models`, §5.1, §9.4) and picks the cheapest suitable entry by
 * *live* price, as `plan/README.md` §5 rule 4 requires. The last entry is the
 * `openrouter.model` seed default (docs/07 §8.5), used alone if the catalogue
 * cannot be read. The three native legs need no such list at all: each
 * provider has its own live model endpoint (§9.1–§9.3).
 */
const CANDIDATE_SLUGS: readonly string[] = [
  "openai/gpt-5.6-luna", // docs/03 §2.5, §16
  "google/gemini-3.1-flash-lite", // docs/03 §4.6 "Cheapest"
  "google/gemini-3.5-flash-lite", // docs/03 §4.6
  "google/gemini-3.8-flash", // docs/03 §5.3, §16
  "anthropic/claude-haiku-4.5", // docs/03 §9.4, §16
  "anthropic/claude-sonnet-5", // docs/07 §8.5 seed default
];

/**
 * Output caps. Small; a non-reasoning model needs 1–2 tokens for "pong".
 * OpenAI gets more because `docs/03` §2.5 records that **every** model of the
 * GPT-5.6/6 family is `reasoning.mandatory` with no `none`/`minimal` level:
 * reasoning tokens are billed as output (§2.6) and are drawn from the same
 * cap, so a cap of 32 buys a `status: "incomplete"` and no text at all.
 */
const MAX_TOKENS: Readonly<Record<ProviderId, number>> = {
  openrouter: 32,
  openai: 256,
  gemini: 128,
  anthropic: 64,
};

/** Rough prompt size incl. chat-template overhead, for the estimate only. */
const PROMPT_TOKENS_ESTIMATE = 40;

/** At most this many POST attempts per provider; only unbilled 4xx move on. */
const MAX_COMPLETION_ATTEMPTS = 3;

const PROMPT_TEXT = "Reply with exactly one word: pong";
const SYSTEM_TEXT = "You are a terse assistant.";

/** Long enough to arrive in several SSE frames, short enough to be free-ish. */
const STREAM_PROMPT = "Count from 1 to 40, one number per line, nothing else.";
const STREAM_MAX_TOKENS = 200;

/** The abort leg wants a generation still running when the canceller fires. */
const ABORT_PROMPT = "Count from 1 to 300, one number per line, nothing else.";
const ABORT_MAX_TOKENS = 1000;
/** ms after the request starts. */
const ABORT_AFTER_MS = 600;
/** ms to keep listening after the abort, to prove no further data arrives. */
const ABORT_QUIET_PERIOD_MS = 2500;

// P0-T35: the abort point P0-T17 could not reach. Its leg fired at t+607 ms
// while the first byte arrived at t+677 ms, so the partial body was 0 chars and
// mid-stream cancellation went unmeasured. These legs trigger on a *progress
// event* instead of a clock, so bytes are guaranteed to have arrived first.
//
// Keyless by design (the card's `Do NOT`): the three open questions — does the
// cancel take effect, is the partial body readable, do further events fire —
// are transport questions, not SSE or provider ones. Europe PMC's
// `resultType=core` carries full abstracts, so 200 records is hundreds of
// kilobytes and arrives in several events.
const MIDSTREAM_URL =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
  "?query=crispr%20base%20editing&format=json&resultType=core&pageSize=200";
const MIDSTREAM_ABORT_AFTER_TICKS = 3;
/** Margin past the measured first-tick time for the facade leg. */
const MIDSTREAM_FACADE_MARGIN_MS = 150;

/** docs/02 §3.3 example (a), verbatim parameters. */
const PUBMED_ESEARCH =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

/** Characters of a response body quoted in the summary. */
const EXCERPT_CHARS = 700;

// ---------------------------------------------------------------------------
// Environment handed in by the paste block's last line
// ---------------------------------------------------------------------------

/** The slice of a `fetch` `Response` this probe reads. */
interface FetchResponseLike {
  readonly status: number;
  readonly body: unknown;
  text(): Promise<string>;
}

interface StreamReaderLike {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel(): Promise<void>;
}

interface ReadableStreamLike {
  getReader(): StreamReaderLike;
  pipeThrough(transform: unknown): ReadableStreamLike;
}

export interface ProbeEnv {
  readonly zotero: {
    readonly version: string;
    readonly HTTP: _ZoteroTypes.HTTP;
    debug(message: string): void;
  };
  readonly services: Pick<JSServices, "prompt" | "wm">;
  /** `Ci` / `Components.interfaces`, for reading back the sent headers. */
  readonly interfaces: unknown;
  /** package.json `version` at emit time; goes into the D10 User-Agent. */
  readonly version: string;
  /**
   * Globals of the **Run JavaScript evaluation global** — the main window,
   * not the plugin sandbox. Used only for the three `docs/01` §8.4 checks and
   * always reported as such. See the file header.
   */
  readonly windowGlobals: {
    /** `typeof` of each name, read in the evaluation global. */
    readonly typeofs: Readonly<Record<string, string>>;
    readonly fetch:
      | ((
          url: string,
          init: Record<string, unknown>,
        ) => Promise<FetchResponseLike>)
      | null;
    readonly AbortController:
      (new () => { readonly signal: unknown; abort(): void }) | null;
    readonly TextDecoderStream: (new () => unknown) | null;
  };
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
      env.zotero.debug(`[research_helper P0-T15/16/17] ${safe}`);
    } catch {
      /* the summary still comes back as the result */
    }
  };

  const verdicts: string[] = [];
  const record = (label: string, verdict: string): void => {
    verdicts.push(`${label.padEnd(46)} ${verdict}`);
  };

  try {
    const userAgent = buildUserAgent(env.version);
    say(
      "research_helper network probe - P0-T15 (V-7), P0-T16 (V-8), P0-T17 (V-9), P0-T35",
    );
    say(`run at      ${new Date().toISOString()}`);
    say(`zotero      ${env.zotero.version}`);
    say(`user-agent  ${userAgent}`);
    say("client      src/core/http/client.ts (anon, successCodes:false,");
    say("            noRetryOnThrottle, errorDelayMax:0, logBodyLength:0)");

    const keys = askForKeys(env);
    for (const id of PROVIDER_ORDER) {
      const key = keys[id];
      if (key !== null) secrets.push(key);
      say(
        `key ${id.padEnd(11)} ${
          key === null
            ? "not entered (dialog cancelled or empty) - leg skipped"
            : `entered via password dialog (${key.length} chars; never shown)`
        }`,
      );
    }

    const probe = instrument(env.zotero.HTTP);
    const client = createHttpClient({ transport: probe.transport, userAgent });

    // ---- shared live price source (docs/03 §9.4) --------------------------
    say();
    const catalogue = await readOpenRouterCatalogue(client, say);

    // ---- P0-T15 -----------------------------------------------------------
    say();
    say("=== P0-T15 (V-7): cross-origin POST with custom headers ===");

    say();
    record(
      "P0-T15 OpenRouter POST",
      keys.openrouter === null
        ? skipped("[1] OpenRouter", say)
        : await openrouterLeg(
            client,
            probe,
            env,
            keys.openrouter,
            catalogue,
            say,
          ),
    );

    say();
    record(
      "P0-T15 OpenAI direct POST",
      keys.openai === null
        ? skipped("[2] OpenAI (direct)", say)
        : await openaiLeg(client, probe, env, keys.openai, catalogue, say),
    );

    say();
    record(
      "P0-T15 Gemini direct POST",
      keys.gemini === null
        ? skipped("[3] Google Gemini (direct)", say)
        : await geminiLeg(client, probe, env, keys.gemini, catalogue, say),
    );

    say();
    record(
      "P0-T15 Anthropic direct POST",
      keys.anthropic === null
        ? skipped("[4] Anthropic (direct)", say)
        : await anthropicLeg(
            client,
            probe,
            env,
            keys.anthropic,
            catalogue,
            say,
          ),
    );

    say();
    record(
      "P0-T15 PubMed E-utilities (keyless)",
      await pubmed(client, probe, env, say),
    );

    // ---- P0-T16 -----------------------------------------------------------
    say();
    say("=== P0-T16 (V-8): SSE streaming ===");

    say();
    record("P0-T16 SSE parser self-check (offline)", sseSelfCheck(say));

    say();
    const streamTarget = pickStreamTarget(keys, catalogue, say);

    say();
    reportGlobals(env, say);

    say();
    record(
      "P0-T16 XHR + requestObserver incremental",
      streamTarget === null
        ? "SKIPPED - no provider key entered"
        : await xhrStreamLeg(env, streamTarget, say),
    );

    say();
    record(
      "P0-T16 fetch + ReadableStream incremental",
      streamTarget === null
        ? "SKIPPED - no provider key entered"
        : await fetchStreamLeg(env, streamTarget, say),
    );

    // ---- P0-T17 -----------------------------------------------------------
    say();
    say("=== P0-T17 (V-9): request abortion ===");

    say();
    record(
      "P0-T17 cancellerReceiver on a live stream",
      await xhrAbortLeg(env, streamTarget, say),
    );

    say();
    record(
      "P0-T17 HttpClient.onCanceller mapping",
      await clientAbortLeg(client, streamTarget, say),
    );

    say();
    record(
      "P0-T17 AbortController (window global only)",
      streamTarget === null
        ? "SKIPPED - no provider key entered"
        : await fetchAbortLeg(env, streamTarget, say),
    );

    // ---- P0-T35 -----------------------------------------------------------
    say();
    say("=== P0-T35: cancellation after the first byte (keyless) ===");

    say();
    const midStream = await midStreamAbortLeg(env, say);
    record("P0-T35 mid-stream cancellerReceiver abort", midStream.verdict);

    say();
    record(
      "P0-T35 HttpClient.onCanceller mapping mid-stream",
      await midStreamClientAbortLeg(client, midStream.firstTickAt, say),
    );

    say();
    say("=== VERDICTS ===");
    for (const v of verdicts) say(v);
  } catch (e) {
    say(`PROBE ABORTED: ${describeError(e)}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Keys — one password dialog per provider; Cancel skips that provider
// ---------------------------------------------------------------------------

const KEY_DIALOG_TEXT: Readonly<Record<ProviderId, string>> = {
  openrouter:
    "Enter your OpenRouter API key.\n\n" +
    "Used for one tiny chat completion plus the streaming and abort legs " +
    "(P0-T16 / P0-T17). Estimated well under US$0.01 in total.",
  openai:
    "Enter your OpenAI API key.\n\n" +
    "Used for one minimal POST /v1/responses completion. Every GPT-5.6/6 " +
    "model reasons unconditionally and reasoning tokens are billed as " +
    "output, so the cap is 256 output tokens. Estimated well under US$0.01.",
  gemini:
    "Enter your Google Gemini API key.\n\n" +
    "Used for one minimal POST /v1beta/interactions completion " +
    "(128 output tokens). Estimated well under US$0.01, and free on the " +
    "free tier.",
  anthropic:
    "Enter your Anthropic API key.\n\n" +
    "Used for one minimal POST /v1/messages completion (64 output tokens). " +
    "Estimated well under US$0.01.",
};

/** Note a leg that will not run, so a skipped provider is visible. */
function skipped(label: string, say: (line?: string) => void): string {
  say(`${label}: SKIPPED - no key entered`);
  return "SKIPPED - no key entered";
}

function askForKeys(
  env: ProbeEnv,
): Readonly<Record<ProviderId, string | null>> {
  const out: Record<ProviderId, string | null> = {
    openrouter: null,
    openai: null,
    gemini: null,
    anthropic: null,
  };
  // Parent the dialogs on the Run JavaScript window so they open in front of
  // it; a null parent is accepted by the prompt service.
  const parent = env.services.wm.getMostRecentWindow("zotero:run-js");
  for (const [i, id] of PROVIDER_ORDER.entries()) {
    const pass = { value: "" };
    let ok: boolean;
    try {
      ok = env.services.prompt.promptPassword(
        parent,
        `${TOOL_NAME} - network probe (${i + 1}/${PROVIDER_ORDER.length}): ${PROVIDER_LABEL[id]}`,
        `${KEY_DIALOG_TEXT[id]}\n\n` +
          "The key is not stored, logged or displayed.\n" +
          `Cancel skips ${PROVIDER_LABEL[id]} only; the rest of the run continues.`,
        pass,
      );
    } catch {
      ok = false; // a prompt that cannot open is the same as a cancel
    }
    const key = ok ? pass.value.trim() : "";
    pass.value = "";
    out[id] = key === "" ? null : key;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live model / price catalogue (docs/03 §9.4)
// ---------------------------------------------------------------------------

interface CatalogueEntry {
  readonly slug: string;
  /** USD per token, from the live catalogue. */
  readonly promptUsd: number;
  readonly completionUsd: number;
  readonly reasoningMandatory: boolean;
  readonly reasoningDefault: boolean;
  readonly supportsMaxTokens: boolean;
  readonly supportsReasoningEffort: boolean;
}

type Catalogue = ReadonlyMap<string, CatalogueEntry>;

/**
 * `GET /api/v1/models` — unauthenticated, and `docs/03` §9.4's explicit
 * recommendation: the only machine-readable price source of the four, usable
 * as a metadata source for all providers even when calling them natively.
 */
async function readOpenRouterCatalogue(
  client: HttpClient,
  say: (line?: string) => void,
): Promise<Catalogue> {
  const url = `${OPENROUTER_BASE}/models`;
  say(`[0] OpenRouter GET ${url} (public catalogue, no auth; docs/03 §9.4)`);

  const x = await timed(() =>
    client.request("GET", url, { timeoutMs: 60_000 }),
  );
  const out = new Map<string, CatalogueEntry>();
  if (!x.response) {
    say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
    say("    no live prices this run; legs fall back to docs-named candidates");
    return out;
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
    return out;
  }

  for (const m of data) {
    const slug = str(at(m, "id"));
    if (slug === null) continue;
    const promptUsd = Number(str(at(m, "pricing", "prompt")) ?? NaN);
    const completionUsd = Number(str(at(m, "pricing", "completion")) ?? NaN);
    if (!(promptUsd > 0 && completionUsd > 0)) continue;
    const params = at(m, "supported_parameters");
    const names = Array.isArray(params) ? params.map((p) => String(p)) : null;
    out.set(slug, {
      slug,
      promptUsd,
      completionUsd,
      reasoningMandatory: at(m, "reasoning", "mandatory") === true,
      reasoningDefault: at(m, "reasoning", "default_enabled") === true,
      supportsMaxTokens: names === null || names.includes("max_tokens"),
      supportsReasoningEffort:
        names !== null && names.includes("reasoning_effort"),
    });
  }
  say(`    priced entries usable as a live price source: ${out.size}`);
  return out;
}

// ---------------------------------------------------------------------------
// Candidate ranking, shared by all four legs
// ---------------------------------------------------------------------------

interface Candidate {
  /** The id to send to the provider being called. */
  readonly id: string;
  /** The OpenRouter slug its price came from, or null when unpriced. */
  readonly slug: string | null;
  readonly promptUsd: number | null;
  readonly completionUsd: number | null;
  readonly estimateUsd: number | null;
  readonly reasoningMandatory: boolean;
  readonly reasoningDefault: boolean;
  readonly supportsReasoningEffort: boolean;
}

/**
 * Rank native model ids by **live** price, cheapest first, preferring models
 * that do not reason by default — `plan/README.md` §5 rule 4 forbids a
 * hardcoded price and `docs/03` §2.6 / §3.6 explain why a thinking model
 * under a tiny output cap returns nothing: the cap is spent on hidden tokens.
 * `rejectReasoning` is on only for the OpenRouter leg, whose 2026-09-15 run
 * established that policy; the native legs must live with what the provider
 * actually offers.
 */
function rank(
  ids: readonly string[],
  toSlug: (id: string) => string,
  catalogue: Catalogue,
  maxTokens: number,
  opts: { readonly rejectReasoning: boolean },
  say: (line?: string) => void,
): readonly Candidate[] {
  const out: Candidate[] = [];
  for (const id of ids) {
    const slug = toSlug(id);
    const entry = catalogue.get(slug);
    if (entry === undefined) {
      out.push({
        id,
        slug: null,
        promptUsd: null,
        completionUsd: null,
        estimateUsd: null,
        reasoningMandatory: false,
        reasoningDefault: false,
        supportsReasoningEffort: false,
      });
      continue;
    }
    if (opts.rejectReasoning && entry.reasoningMandatory) {
      say(
        `    - ${id}: skipped, reasoning mandatory (would eat the token cap)`,
      );
      continue;
    }
    if (opts.rejectReasoning && !entry.supportsMaxTokens) {
      say(`    - ${id}: skipped, max_tokens unsupported`);
      continue;
    }
    out.push({
      id,
      slug,
      promptUsd: entry.promptUsd,
      completionUsd: entry.completionUsd,
      estimateUsd:
        PROMPT_TOKENS_ESTIMATE * entry.promptUsd +
        maxTokens * entry.completionUsd,
      reasoningMandatory: entry.reasoningMandatory,
      reasoningDefault: entry.reasoningDefault,
      supportsReasoningEffort: entry.supportsReasoningEffort,
    });
  }
  out.sort(
    (a, b) =>
      Number(a.estimateUsd === null) - Number(b.estimateUsd === null) ||
      Number(a.reasoningDefault || a.reasoningMandatory) -
        Number(b.reasoningDefault || b.reasoningMandatory) ||
      (a.estimateUsd ?? 0) - (b.estimateUsd ?? 0),
  );
  return out;
}

function describeCandidate(c: Candidate): string {
  const price =
    c.promptUsd === null || c.completionUsd === null
      ? "price unknown (not in the OpenRouter catalogue)"
      : `$${perMillion(c.promptUsd)}/$${perMillion(c.completionUsd)} per 1M` +
        (c.estimateUsd === null
          ? ""
          : `, this call <= $${c.estimateUsd.toFixed(6)}`);
  const reasoning = c.reasoningMandatory
    ? ", reasoning mandatory"
    : c.reasoningDefault
      ? ", reasoning on by default"
      : "";
  return `${c.id}: ${price}${reasoning}`;
}

function announceOrder(
  what: string,
  ranked: readonly Candidate[],
  say: (line?: string) => void,
): void {
  for (const c of ranked.slice(0, MAX_COMPLETION_ATTEMPTS)) {
    say(`    - ${describeCandidate(c)}`);
  }
  say(
    `    ${what} order: ${ranked
      .slice(0, MAX_COMPLETION_ATTEMPTS)
      .map((c) => c.id)
      .join(", ")} (cheapest live price first, non-reasoning preferred)`,
  );
}

/** docs/03 §9.4: author prefix, then `-<major>-<minor>` becomes `-<major>.<minor>`. */
function anthropicSlug(id: string): string {
  return `anthropic/${id.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;
}

// ---------------------------------------------------------------------------
// Leg: OpenRouter (unchanged in substance from the 2026-09-15 run)
// ---------------------------------------------------------------------------

async function openrouterLeg(
  client: HttpClient,
  probe: Instrumented,
  env: ProbeEnv,
  key: string,
  catalogue: Catalogue,
  say: (line?: string) => void,
): Promise<string> {
  const url = `${OPENROUTER_BASE}/chat/completions`;
  say(`[1] OpenRouter POST ${url} (docs/03 §5.1-§5.3)`);
  const ranked = rank(
    CANDIDATE_SLUGS,
    (id) => id,
    catalogue,
    MAX_TOKENS.openrouter,
    { rejectReasoning: true },
    say,
  );
  if (ranked.length === 0) {
    say("    no suitable catalogue entry; nothing safe to send");
    return "FAIL - no model candidate survived the live catalogue filter";
  }
  announceOrder("attempt", ranked, say);

  let verdict = "FAIL - no attempt made";
  for (const [i, model] of ranked.slice(0, MAX_COMPLETION_ATTEMPTS).entries()) {
    const headers = openrouterHeaders(key);
    // docs/03 §5.3 minimal request; `provider.data_collection: "deny"` is D6.
    const body = JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content: PROMPT_TEXT }],
      max_tokens: MAX_TOKENS.openrouter,
      provider: {
        require_parameters: true,
        data_collection: "deny",
        sort: "price",
      },
    });
    say(`  [1.${i + 1}] model ${model.id}, body ${body}`);

    const x = await timed(() =>
      client.request("POST", url, { headers, body, timeoutMs: 120_000 }),
    );
    reportSentHeaders(probe.last(), env, say, {
      show: [
        "User-Agent",
        "Content-Type",
        "HTTP-Referer",
        "X-Title",
        "X-OpenRouter-Title",
        "X-OpenRouter-Metadata",
      ],
      secretHeaders: [{ name: "Authorization", expected: `Bearer ${key}` }],
    });
    if (!x.response) {
      say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
      return `FAIL - ${describeError(x.error)}`;
    }
    const r = x.response;
    const doc = parseJson(r.body);
    sayStatus(r, x.ms, doc, say);

    if (r.status !== 200) {
      verdict = reportHttpError(r, doc, ["error", "message"], say);
      if (r.status === 404 || r.status === 400) continue; // unroutable, unbilled
      return verdict;
    }

    const content = str(at(doc, "choices", 0, "message", "content"));
    const finish = str(at(doc, "choices", 0, "finish_reason"));
    const cost = at(doc, "usage", "cost");
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
        at(doc, "openrouter_metadata") !== undefined
          ? "yes (openrouter_metadata present in response)"
          : "not evidenced (openrouter_metadata absent)"
      }`,
    );
    say(
      "    HTTP-Referer / X-Title arrival: check openrouter.ai/activity " +
        "(App column should read research_helper)",
    );
    say(`    body: ${excerpt(r.body)}`);
    return at(doc, "error") === undefined && content !== null
      ? `PASS - HTTP 200, finish_reason ${finish ?? "-"}, cost $${String(cost ?? "?")}`
      : "FAIL - HTTP 200 but no completion";
  }
  return verdict;
}

/** docs/03 §5.2 auth + attribution headers. */
function openrouterHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": PROJECT_URL,
    "X-Title": TOOL_NAME,
    "X-OpenRouter-Title": TOOL_NAME,
    // §5.2: makes the response carry `openrouter_metadata`, which proves a
    // non-auth custom header reached OpenRouter.
    "X-OpenRouter-Metadata": "enabled",
  };
}

// ---------------------------------------------------------------------------
// Leg: OpenAI direct (docs/03 §2.1-§2.4, §9.1)
// ---------------------------------------------------------------------------

/** docs/03 §9.1: the list mixes in non-chat models; this is its filter. */
const OPENAI_NON_CHAT =
  /embedding|tts|transcribe|whisper|image|realtime|moderation|audio|dall-e|sora/i;

function openaiHeaders(key: string): Record<string, string> {
  // docs/03 §2.2. The optional OpenAI-Organization / OpenAI-Project headers
  // are deliberately not sent: they are not needed and would be one more
  // account identifier on the wire.
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function openaiLeg(
  client: HttpClient,
  probe: Instrumented,
  env: ProbeEnv,
  key: string,
  catalogue: Catalogue,
  say: (line?: string) => void,
): Promise<string> {
  const listUrl = `${OPENAI_BASE}/models`;
  say(`[2] OpenAI GET ${listUrl} (live model list, docs/03 §9.1)`);
  const listed = await timed(() =>
    client.request("GET", listUrl, {
      headers: openaiHeaders(key),
      timeoutMs: 60_000,
    }),
  );
  if (!listed.response) {
    say(`    FAILED after ${listed.ms} ms: ${describeError(listed.error)}`);
    return `FAIL - model list unreachable: ${describeError(listed.error)}`;
  }
  const listDoc = parseJson(listed.response.body);
  sayStatus(listed.response, listed.ms, listDoc, say);
  if (listed.response.status !== 200) {
    reportHttpError(listed.response, listDoc, ["error", "message"], say);
    return `FAIL - GET /v1/models HTTP ${listed.response.status} (key or header rejected)`;
  }
  const ids = arr(at(listDoc, "data"))
    .map((m) => str(at(m, "id")))
    .filter((id): id is string => id !== null && !OPENAI_NON_CHAT.test(id));
  say(`    ${ids.length} chat-capable ids after the §9.1 filter`);
  // §9.1: the list carries no pricing at all, so price comes from §9.4's
  // catalogue under the author-prefix rule.
  const ranked = rank(
    ids,
    (id) => `openai/${id}`,
    catalogue,
    MAX_TOKENS.openai,
    { rejectReasoning: false },
    say,
  ).filter((c) => c.estimateUsd !== null);
  if (ranked.length === 0) {
    say("    no listed model has a live price; refusing to spend blind");
    return "FAIL - no live price for any listed model (plan/README §5 rule 4)";
  }
  announceOrder("attempt", ranked, say);

  const url = `${OPENAI_BASE}/responses`;
  let verdict = "FAIL - no attempt made";
  for (const [i, model] of ranked.slice(0, MAX_COMPLETION_ATTEMPTS).entries()) {
    // docs/03 §2.3 minimal request. `reasoning.effort` is sent only when the
    // live catalogue says the model has the parameter: §2.5 records that the
    // GPT-5.6/6 family reasons unconditionally with `low` as the floor, but a
    // non-reasoning model rejects the field.
    const sendReasoning =
      model.supportsReasoningEffort ||
      model.reasoningMandatory ||
      model.reasoningDefault;
    const body = JSON.stringify({
      model: model.id,
      input: [
        { role: "system", content: SYSTEM_TEXT },
        { role: "user", content: PROMPT_TEXT },
      ],
      max_output_tokens: MAX_TOKENS.openai,
      ...(sendReasoning && { reasoning: { effort: "low" } }),
    });
    say(`  [2.${i + 1}] POST ${url}`);
    say(`    model ${model.id}, body ${body}`);

    const x = await timed(() =>
      client.request("POST", url, {
        headers: openaiHeaders(key),
        body,
        timeoutMs: 120_000,
      }),
    );
    reportSentHeaders(probe.last(), env, say, {
      show: ["User-Agent", "Content-Type"],
      secretHeaders: [{ name: "Authorization", expected: `Bearer ${key}` }],
    });
    if (!x.response) {
      say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
      return `FAIL - ${describeError(x.error)}`;
    }
    const r = x.response;
    const doc = parseJson(r.body);
    sayStatus(r, x.ms, doc, say);
    if (r.status !== 200) {
      verdict = reportHttpError(r, doc, ["error", "message"], say);
      if (r.status === 400 || r.status === 404) continue; // unbilled
      return verdict;
    }

    // §2.4: `output` is an array and a reasoning item precedes the message.
    // Never read output[0].
    const status = str(at(doc, "status"));
    const incomplete = str(at(doc, "incomplete_details", "reason"));
    const text = openaiOutputText(doc);
    say(
      `    status ${status ?? "-"}, incomplete_details.reason ${incomplete ?? "null"}`,
    );
    say(
      `    output item types: ${
        arr(at(doc, "output"))
          .map((o) => String(at(o, "type")))
          .join(", ") || "-"
      }`,
    );
    say(`    output_text ${JSON.stringify(text)}`);
    say(
      `    usage: input ${String(at(doc, "usage", "input_tokens") ?? "-")}, ` +
        `output ${String(at(doc, "usage", "output_tokens") ?? "-")} ` +
        "(includes hidden reasoning tokens, docs/03 §2.6)",
    );
    say(`    body: ${excerpt(r.body)}`);
    if (status === "completed" && text !== null && text !== "") {
      return `PASS - HTTP 200, status completed, text ${JSON.stringify(excerpt(text, 40))}`;
    }
    if (status === "incomplete" && incomplete === "max_output_tokens") {
      // V-7's question is "custom headers accepted, full response received",
      // and both are answered. The truncation is a cost knob, not a failure.
      return (
        "PASS (truncated) - HTTP 200, headers accepted, full response body " +
        `received; status incomplete because ${MAX_TOKENS.openai} output tokens ` +
        "were spent on reasoning (docs/03 §2.5, §2.6)"
      );
    }
    return `FAIL - HTTP 200 but status ${status ?? "?"} and no output_text`;
  }
  return verdict;
}

/** docs/03 §2.4: filter `output` for `message`, then `content` for `output_text`. */
function openaiOutputText(doc: unknown): string | null {
  const parts: string[] = [];
  for (const item of arr(at(doc, "output"))) {
    if (at(item, "type") !== "message") continue;
    for (const c of arr(at(item, "content"))) {
      if (at(c, "type") !== "output_text") continue;
      const t = str(at(c, "text"));
      if (t !== null) parts.push(t);
    }
  }
  return parts.length === 0 ? null : parts.join("");
}

// ---------------------------------------------------------------------------
// Leg: Gemini direct (docs/03 §4.1-§4.5, §9.3)
// ---------------------------------------------------------------------------

function geminiHeaders(key: string): Record<string, string> {
  // docs/03 §4.2 + §1.3 + docs/09 §2.1: the header, never `?key=`.
  return { "x-goog-api-key": key, "Content-Type": "application/json" };
}

async function geminiLeg(
  client: HttpClient,
  probe: Instrumented,
  env: ProbeEnv,
  key: string,
  catalogue: Catalogue,
  say: (line?: string) => void,
): Promise<string> {
  const listUrl = `${GEMINI_BASE}/v1beta/models`;
  say(`[3] Gemini GET ${listUrl} (live model list, docs/03 §9.3)`);
  const listed = await timed(() =>
    client.request("GET", listUrl, {
      headers: geminiHeaders(key),
      timeoutMs: 60_000,
    }),
  );
  if (!listed.response) {
    say(`    FAILED after ${listed.ms} ms: ${describeError(listed.error)}`);
    return `FAIL - model list unreachable: ${describeError(listed.error)}`;
  }
  const listDoc = parseJson(listed.response.body);
  sayStatus(listed.response, listed.ms, listDoc, say);
  if (listed.response.status !== 200) {
    reportHttpError(listed.response, listDoc, ["error", "message"], say);
    return `FAIL - GET /v1beta/models HTTP ${listed.response.status} (key or header rejected)`;
  }
  // §9.3: filter on supportedGenerationMethods, strip the `models/` prefix.
  const ids = arr(at(listDoc, "models"))
    .filter((m) =>
      arr(at(m, "supportedGenerationMethods")).some(
        (s) => String(s) === "generateContent",
      ),
    )
    .map((m) => str(at(m, "name")))
    .filter((n): n is string => n !== null)
    .map((n) => n.replace(/^models\//, ""));
  say(`    ${ids.length} models advertising generateContent`);
  say(
    "    note: the list's supportedGenerationMethods describes the LEGACY " +
      "surface; docs/03 §9.3 offers no Interactions-API capability flag",
  );
  const ranked = rank(
    ids,
    (id) => `google/${id}`,
    catalogue,
    MAX_TOKENS.gemini,
    { rejectReasoning: false },
    say,
  ).filter((c) => c.estimateUsd !== null);
  if (ranked.length === 0) {
    say("    no listed model has a live price; refusing to spend blind");
    return "FAIL - no live price for any listed model (plan/README §5 rule 4)";
  }
  announceOrder("attempt", ranked, say);

  const interactions = `${GEMINI_BASE}/v1beta/interactions`;
  let verdict = "FAIL - no attempt made";
  for (const [i, model] of ranked.slice(0, MAX_COMPLETION_ATTEMPTS).entries()) {
    // docs/03 §4.3 minimal Interactions request; snake_case throughout (§4.5
    // warns that mixing in the legacy camelCase silently drops fields).
    const body = JSON.stringify({
      model: model.id,
      system_instruction: SYSTEM_TEXT,
      input: PROMPT_TEXT,
      generation_config: {
        max_output_tokens: MAX_TOKENS.gemini,
        thinking_level: "minimal",
      },
    });
    say(`  [3.${i + 1}] POST ${interactions} (Interactions API, docs/03 §4.3)`);
    say(`    model ${model.id}, body ${body}`);

    const x = await timed(() =>
      client.request("POST", interactions, {
        headers: geminiHeaders(key),
        body,
        timeoutMs: 120_000,
      }),
    );
    reportSentHeaders(probe.last(), env, say, {
      show: ["User-Agent", "Content-Type"],
      secretHeaders: [{ name: "x-goog-api-key", expected: key }],
    });
    if (!x.response) {
      say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
      return `FAIL - ${describeError(x.error)}`;
    }
    const r = x.response;
    const doc = parseJson(r.body);
    sayStatus(r, x.ms, doc, say);

    if (r.status === 200) {
      // §4.4: a `steps` array, not `candidates` and not `outputs`.
      const status = str(at(doc, "status"));
      const text = geminiStepsText(doc);
      say(
        `    status ${status ?? "-"}, step types: ${
          arr(at(doc, "steps"))
            .map((s) => String(at(s, "type")))
            .join(", ") || "-"
        }`,
      );
      say(`    text ${JSON.stringify(text)}`);
      say(
        `    usage: input ${String(at(doc, "usage", "total_input_tokens") ?? "-")}, ` +
          `output ${String(at(doc, "usage", "total_output_tokens") ?? "-")}, ` +
          `thought ${String(at(doc, "usage", "total_thought_tokens") ?? "-")}`,
      );
      say(`    body: ${excerpt(r.body)}`);
      if (status === "completed" && text !== null && text !== "") {
        return `PASS - Interactions API, HTTP 200, text ${JSON.stringify(excerpt(text, 40))}`;
      }
      verdict = `FAIL - Interactions API HTTP 200 but status ${status ?? "?"}`;
    } else {
      verdict = reportHttpError(r, doc, ["error", "message"], say);
      if (r.status !== 400 && r.status !== 404) return verdict;
    }

    // §4.1 / §4.5: `generateContent` is "legacy" but "remains fully
    // supported" and is the documented fallback. One attempt, same model.
    const legacyUrl = `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
    const legacyBody = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_TEXT }] },
      contents: [{ role: "user", parts: [{ text: PROMPT_TEXT }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS.gemini },
    });
    say(`  [3.${i + 1}b] POST ${legacyUrl} (legacy fallback, docs/03 §4.5)`);
    const y = await timed(() =>
      client.request("POST", legacyUrl, {
        headers: geminiHeaders(key),
        body: legacyBody,
        timeoutMs: 120_000,
      }),
    );
    if (!y.response) {
      say(`    FAILED after ${y.ms} ms: ${describeError(y.error)}`);
      continue;
    }
    const lr = y.response;
    const ldoc = parseJson(lr.body);
    sayStatus(lr, y.ms, ldoc, say);
    if (lr.status !== 200) {
      verdict = reportHttpError(lr, ldoc, ["error", "message"], say);
      continue;
    }
    const legacyText = str(
      at(ldoc, "candidates", 0, "content", "parts", 0, "text"),
    );
    say(`    text ${JSON.stringify(legacyText)}`);
    say(`    body: ${excerpt(lr.body)}`);
    if (legacyText !== null && legacyText !== "") {
      return (
        "PASS (legacy surface) - x-goog-api-key accepted; " +
        `generateContent HTTP 200, text ${JSON.stringify(excerpt(legacyText, 40))}. ` +
        "The Interactions API attempt above did not succeed - see its line."
      );
    }
  }
  return verdict;
}

/** docs/03 §4.4: filter `steps` for `model_output`, then `content` for `text`. */
function geminiStepsText(doc: unknown): string | null {
  const parts: string[] = [];
  for (const step of arr(at(doc, "steps"))) {
    if (at(step, "type") !== "model_output") continue;
    for (const c of arr(at(step, "content"))) {
      const t = str(at(c, "text"));
      if (t !== null) parts.push(t);
    }
  }
  return parts.length === 0 ? null : parts.join("");
}

// ---------------------------------------------------------------------------
// Leg: Anthropic direct (docs/03 §3.1-§3.4, §9.2)
// ---------------------------------------------------------------------------

function anthropicHeaders(key: string): Record<string, string> {
  // docs/03 §3.2. `anthropic-version` is required on every request;
  // `anthropic-dangerous-direct-browser-access` is §3.2's belt-and-braces for
  // §1.2's browser-origin restriction and is also the most visible proof that
  // a non-auth custom header reached the provider.
  return {
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

async function anthropicLeg(
  client: HttpClient,
  probe: Instrumented,
  env: ProbeEnv,
  key: string,
  catalogue: Catalogue,
  say: (line?: string) => void,
): Promise<string> {
  say(
    `[4] Anthropic GET ${ANTHROPIC_BASE}/v1/models (live model list, docs/03 §9.2)`,
  );
  const ids: string[] = [];
  let lastId: string | null = null;
  // §9.2: the endpoint auto-paginates; follow has_more / last_id.
  for (let page = 0; page < 3; page++) {
    const url =
      `${ANTHROPIC_BASE}/v1/models?limit=100` +
      (lastId === null ? "" : `&after_id=${encodeURIComponent(lastId)}`);
    const listed = await timed(() =>
      client.request("GET", url, {
        headers: anthropicHeaders(key),
        timeoutMs: 60_000,
      }),
    );
    if (!listed.response) {
      say(`    FAILED after ${listed.ms} ms: ${describeError(listed.error)}`);
      return `FAIL - model list unreachable: ${describeError(listed.error)}`;
    }
    const doc = parseJson(listed.response.body);
    sayStatus(listed.response, listed.ms, doc, say);
    if (listed.response.status !== 200) {
      reportHttpError(listed.response, doc, ["error", "message"], say);
      return `FAIL - GET /v1/models HTTP ${listed.response.status} (key, x-api-key or anthropic-version rejected)`;
    }
    for (const m of arr(at(doc, "data"))) {
      const id = str(at(m, "id"));
      if (id !== null) ids.push(id);
    }
    if (at(doc, "has_more") !== true) break;
    lastId = str(at(doc, "last_id"));
    if (lastId === null) break;
  }
  say(`    ${ids.length} models listed`);
  const ranked = rank(
    ids,
    anthropicSlug,
    catalogue,
    MAX_TOKENS.anthropic,
    { rejectReasoning: false },
    say,
  ).filter((c) => c.estimateUsd !== null);
  if (ranked.length === 0) {
    say("    no listed model has a live price; refusing to spend blind");
    say("    (check the §9.4 dash->dot slug rule if this is unexpected)");
    return "FAIL - no live price for any listed model (plan/README §5 rule 4)";
  }
  announceOrder("attempt", ranked, say);

  const url = `${ANTHROPIC_BASE}/v1/messages`;
  let verdict = "FAIL - no attempt made";
  for (const [i, model] of ranked.slice(0, MAX_COMPLETION_ATTEMPTS).entries()) {
    // docs/03 §3.3 minimal request: `max_tokens` is REQUIRED and `system` is
    // a TOP-LEVEL field, not a message. §3.6's `thinking` / `output_config`
    // are deliberately absent — the minimal request is what V-7 asks about,
    // and `budget_tokens` on a current model is a 400.
    const body = JSON.stringify({
      model: model.id,
      max_tokens: MAX_TOKENS.anthropic,
      system: SYSTEM_TEXT,
      messages: [{ role: "user", content: PROMPT_TEXT }],
    });
    say(`  [4.${i + 1}] POST ${url}`);
    say(`    model ${model.id}, body ${body}`);
    if (model.reasoningDefault) {
      say(
        "    note: the live catalogue reports thinking on by default for this " +
          "model (docs/03 §3.6) - the token cap may go to thinking",
      );
    }

    const x = await timed(() =>
      client.request("POST", url, {
        headers: anthropicHeaders(key),
        body,
        timeoutMs: 120_000,
      }),
    );
    reportSentHeaders(probe.last(), env, say, {
      show: [
        "User-Agent",
        "content-type",
        "anthropic-version",
        "anthropic-dangerous-direct-browser-access",
      ],
      secretHeaders: [{ name: "x-api-key", expected: key }],
    });
    if (!x.response) {
      say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
      return `FAIL - ${describeError(x.error)}`;
    }
    const r = x.response;
    const doc = parseJson(r.body);
    sayStatus(r, x.ms, doc, say);
    if (r.status !== 200) {
      verdict = reportHttpError(r, doc, ["error", "message"], say);
      if (r.status === 400 || r.status === 404) continue; // unbilled
      return verdict;
    }

    // §3.4: always check stop_reason BEFORE reading content.
    const stop = str(at(doc, "stop_reason"));
    const text = anthropicText(doc);
    say(
      `    stop_reason ${stop ?? "-"}, content block types: ${
        arr(at(doc, "content"))
          .map((c) => String(at(c, "type")))
          .join(", ") || "-"
      }`,
    );
    say(`    text ${JSON.stringify(text)}`);
    say(
      `    usage: input ${String(at(doc, "usage", "input_tokens") ?? "-")}` +
        ` (+cache_creation ${String(at(doc, "usage", "cache_creation_input_tokens") ?? "-")}` +
        `, +cache_read ${String(at(doc, "usage", "cache_read_input_tokens") ?? "-")})` +
        `, output ${String(at(doc, "usage", "output_tokens") ?? "-")}`,
    );
    say(`    body: ${excerpt(r.body)}`);
    if (stop === "refusal") {
      return `FAIL - stop_reason refusal (stop_details ${JSON.stringify(at(doc, "stop_details"))})`;
    }
    if (text !== null && text !== "") {
      return `PASS - HTTP 200, stop_reason ${stop ?? "-"}, text ${JSON.stringify(excerpt(text, 40))}`;
    }
    if (stop === "max_tokens") {
      return (
        "PASS (truncated) - HTTP 200, x-api-key and anthropic-version accepted, " +
        `full response body received; stop_reason max_tokens at ${MAX_TOKENS.anthropic}`
      );
    }
    return `FAIL - HTTP 200 but no text block (stop_reason ${stop ?? "?"})`;
  }
  return verdict;
}

/** docs/03 §3.4: `content` is an array of blocks; filter `text` and join. */
function anthropicText(doc: unknown): string | null {
  const parts: string[] = [];
  for (const block of arr(at(doc, "content"))) {
    if (at(block, "type") !== "text") continue;
    const t = str(at(block, "text"));
    if (t !== null) parts.push(t);
  }
  return parts.length === 0 ? null : parts.join("");
}

// ---------------------------------------------------------------------------
// Leg: PubMed (unchanged)
// ---------------------------------------------------------------------------

async function pubmed(
  client: HttpClient,
  probe: Instrumented,
  env: ProbeEnv,
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
  say(`[5] PubMed GET ${url}`);

  const x = await timed(() =>
    client.request("GET", url, {
      headers: { Accept: "application/json" },
      timeoutMs: 30_000,
    }),
  );
  reportSentHeaders(probe.last(), env, say, {
    show: ["User-Agent"],
    secretHeaders: [],
  });
  if (!x.response) {
    say(`    FAILED after ${x.ms} ms: ${describeError(x.error)}`);
    return `FAIL - ${describeError(x.error)}`;
  }
  const r = x.response;
  const doc = parseJson(r.body);
  const count = str(at(doc, "esearchresult", "count"));
  const ids = arr(at(doc, "esearchresult", "idlist"));
  const backendError = at(doc, "esearchresult", "ERROR");
  sayStatus(r, x.ms, doc, say);
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

// ---------------------------------------------------------------------------
// P0-T16: SSE
// ---------------------------------------------------------------------------

/**
 * A provider's streaming shape. `docs/03` §6 owns all four; the framing is
 * identical and the payloads are not.
 */
interface StreamTarget {
  readonly provider: ProviderId;
  readonly model: string;
  readonly estimateUsdPerToken: number | null;
  url(purpose: "stream"): string;
  headers(): Record<string, string>;
  body(prompt: string, maxTokens: number): string;
  /** Text delta carried by this event, or null if it carries none. */
  delta(event: SseEvent): string | null;
  /** True when this event ends the stream (`[DONE]`, `response.completed`…). */
  isEnd(event: SseEvent): boolean;
  /** A mid-stream error delivered with HTTP 200 already sent (§6.2 note 4). */
  streamError(event: SseEvent): string | null;
}

function makeStreamTarget(
  provider: ProviderId,
  key: string,
  candidate: Candidate,
): StreamTarget {
  const model = candidate.id;
  const completionUsd = candidate.completionUsd;
  const base = { provider, model, estimateUsdPerToken: completionUsd };

  if (provider === "openrouter") {
    // docs/03 §6.4: OpenAI Chat-Completions-shaped deltas, `[DONE]`
    // sentinel, and `: OPENROUTER PROCESSING` comment keepalives.
    return {
      ...base,
      url: () => `${OPENROUTER_BASE}/chat/completions`,
      headers: () => openrouterHeaders(key),
      body: (prompt, maxTokens) =>
        JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          stream: true,
          provider: { data_collection: "deny" }, // D6, on every request
        }),
      delta: (e) =>
        e.data === "[DONE]"
          ? null
          : str(at(parseJson(e.data), "choices", 0, "delta", "content")),
      isEnd: (e) => e.data === "[DONE]",
      streamError: (e) => str(at(parseJson(e.data), "error", "message")),
    };
  }
  if (provider === "anthropic") {
    // docs/03 §6.2.
    return {
      ...base,
      url: () => `${ANTHROPIC_BASE}/v1/messages`,
      headers: () => anthropicHeaders(key),
      body: (prompt, maxTokens) =>
        JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      delta: (e) => {
        if (e.type !== "content_block_delta") return null;
        const d = at(parseJson(e.data), "delta");
        // §6.2 note 1: delta.type discriminates the payload.
        return at(d, "type") === "text_delta" ? str(at(d, "text")) : null;
      },
      isEnd: (e) => e.type === "message_stop",
      streamError: (e) =>
        e.type === "error"
          ? str(at(parseJson(e.data), "error", "message"))
          : null,
    };
  }
  if (provider === "openai") {
    // docs/03 §6.1: typed events, and NO `[DONE]` on the Responses API.
    return {
      ...base,
      url: () => `${OPENAI_BASE}/responses`,
      headers: () => openaiHeaders(key),
      body: (prompt, maxTokens) =>
        JSON.stringify({
          model,
          input: [{ role: "user", content: prompt }],
          max_output_tokens: maxTokens,
          stream: true,
        }),
      delta: (e) =>
        e.type === "response.output_text.delta"
          ? str(at(parseJson(e.data), "delta"))
          : null,
      isEnd: (e) =>
        e.type === "response.completed" || e.type === "response.failed",
      streamError: (e) =>
        e.type === "error" ? str(at(parseJson(e.data), "message")) : null,
    };
  }
  // Gemini. docs/03 §6.3 fixes the LEGACY shape precisely — `?alt=sse`, each
  // `data:` line a full GenerateContentResponse with a partial
  // `candidates[0].content.parts[0].text` — while for the Interactions API it
  // names the events (`step.delta`) without fixing the text payload. The
  // probe uses the documented one rather than guessing, and says so.
  return {
    ...base,
    url: () =>
      `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: () => geminiHeaders(key),
    body: (prompt, maxTokens) =>
      JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    delta: (e) =>
      str(
        at(parseJson(e.data), "candidates", 0, "content", "parts", 0, "text"),
      ),
    isEnd: () => false, // the connection closing is the end
    streamError: (e) => str(at(parseJson(e.data), "error", "message")),
  };
}

/** Preference order: cheapest and best-documented streaming shape first. */
const STREAM_PREFERENCE: readonly ProviderId[] = [
  "openrouter",
  "anthropic",
  "openai",
  "gemini",
];

function pickStreamTarget(
  keys: Readonly<Record<ProviderId, string | null>>,
  catalogue: Catalogue,
  say: (line?: string) => void,
): StreamTarget | null {
  for (const provider of STREAM_PREFERENCE) {
    const key = keys[provider];
    if (key === null) continue;
    const prefix = authorPrefix(provider);
    const entry = [...catalogue.values()]
      // OpenRouter routes every author, so it has no prefix to filter on.
      .filter((e) => prefix === null || e.slug.startsWith(`${prefix}/`))
      // A model that thinks by default spends the cap on hidden tokens and
      // emits no text deltas at all (docs/03 §2.6, §3.6) — which would make
      // an incremental stream look like a failure.
      .filter((e) => !e.reasoningMandatory && !e.reasoningDefault)
      .filter((e) => e.supportsMaxTokens)
      .sort((a, b) => a.completionUsd - b.completionUsd)[0];
    if (entry === undefined) {
      say(`    ${PROVIDER_LABEL[provider]}: no non-reasoning priced model`);
      continue;
    }
    const id =
      provider === "openrouter" ? entry.slug : nativeId(provider, entry.slug);
    const candidate: Candidate = {
      id,
      slug: entry.slug,
      promptUsd: entry.promptUsd,
      completionUsd: entry.completionUsd,
      estimateUsd:
        PROMPT_TOKENS_ESTIMATE * entry.promptUsd +
        STREAM_MAX_TOKENS * entry.completionUsd,
      reasoningMandatory: entry.reasoningMandatory,
      reasoningDefault: entry.reasoningDefault,
      supportsReasoningEffort: entry.supportsReasoningEffort,
    };
    say(
      `[7] streaming provider: ${PROVIDER_LABEL[provider]}, model ${id} ` +
        `($${perMillion(entry.completionUsd)} per 1M out, live catalogue)`,
    );
    say(
      `    stream leg <= $${candidate.estimateUsd?.toFixed(6) ?? "?"}, ` +
        `each abort leg <= $${(PROMPT_TOKENS_ESTIMATE * entry.promptUsd + ABORT_MAX_TOKENS * entry.completionUsd).toFixed(6)} ` +
        "(an aborted generation is billed only for what was produced)",
    );
    return makeStreamTarget(provider, key, candidate);
  }
  say("[7] streaming and abort legs: no usable provider key - SKIPPED");
  return null;
}

/**
 * The OpenRouter author prefix for a native provider (`docs/03` §9.4), or
 * `null` for OpenRouter itself, which routes every author.
 */
function authorPrefix(provider: ProviderId): string | null {
  return provider === "openai"
    ? "openai"
    : provider === "gemini"
      ? "google"
      : provider === "anthropic"
        ? "anthropic"
        : null;
}

/** Inverse of the §9.4 slug rule, for the two providers that need it. */
function nativeId(provider: ProviderId, slug: string): string {
  const bare = slug.slice(slug.indexOf("/") + 1);
  return provider === "anthropic" ? bare.replace(/\.(\d+)$/, "-$1") : bare;
}

/**
 * Offline proof that the frame parser is right, using the recorded sequences
 * `docs/03` §6.1, §6.2 and §6.4 print verbatim. `P0-T16`'s third criterion
 * wants this as a vitest unit test; that needs a test file, which is not in
 * any of the three cards' `Files` lists, so it runs here instead and the
 * criterion stays open. See the report.
 */
function sseSelfCheck(say: (line?: string) => void): string {
  const failures: string[] = [];
  const check = (name: string, got: unknown, want: unknown): void => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    say(`    ${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) failures.push(`${name}: got ${JSON.stringify(got)}`);
  };
  say("[6] SSE frame parser self-check (src/llm/shared/sse.ts, no network)");

  const openrouter =
    ": OPENROUTER PROCESSING\n\n" +
    'data: {"choices":[{"delta":{"content":"This"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":" is"}}]}\n\n' +
    "data: [DONE]\n\n";
  check(
    "docs/03 §6.4 OpenRouter: comment skipped, 2 deltas, [DONE] surfaced",
    parseSse(openrouter).map((e) =>
      e.data === "[DONE]"
        ? "[DONE]"
        : str(at(parseJson(e.data), "choices", 0, "delta", "content")),
    ),
    ["This", " is", "[DONE]"],
  );

  const openai =
    'event: response.created\ndata: {"type":"response.created"}\n\n' +
    'event: response.output_text.delta\ndata: {"delta":"This randomized"}\n\n' +
    'event: response.output_text.delta\ndata: {"delta":" trial found"}\n\n' +
    'event: response.completed\ndata: {"type":"response.completed"}\n\n';
  check(
    "docs/03 §6.1 OpenAI: event: lines typed, no [DONE]",
    parseSse(openai).map((e) => e.type),
    [
      "response.created",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.completed",
    ],
  );

  const anthropic =
    'event: message_start\ndata: {"type":"message_start"}\n\n' +
    'event: ping\ndata: {"type":"ping"}\n\n' +
    'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
    'event: content_block_delta\ndata: {"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n' +
    'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"!"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  check(
    "docs/03 §6.2 Anthropic: delta.type discriminates, ping ignored",
    parseSse(anthropic)
      .filter((e) => e.type === "content_block_delta")
      .map((e) => at(parseJson(e.data), "delta", "type")),
    ["text_delta", "thinking_delta", "text_delta"],
  );

  // Chunk boundaries must not change the result: feed one character at a time.
  const p = createSseParser();
  const streamed: SseEvent[] = [];
  for (const ch of anthropic) streamed.push(...p.push(ch));
  streamed.push(...p.end());
  check(
    "char-by-char feed == whole-text parse (no boundary loss)",
    streamed,
    parseSse(anthropic),
  );

  // A CRLF split across two chunks must not end the frame early.
  const q = createSseParser();
  check(
    "CRLF split across chunks stays one line",
    [...q.push("data: a\r"), ...q.push("\n\r\n")].map((e) => e.data),
    ["a"],
  );

  // An aborted stream's tail (P0-T17: is a partial body readable?).
  const t = createSseParser();
  check(
    "truncated tail recovered by end()",
    [...t.push('data: {"partial":tru'), ...t.end()].map((e) => e.data),
    ['{"partial":tru'],
  );

  return failures.length === 0
    ? "PASS - 6/6 checks against docs/03 §6 recorded frames"
    : `FAIL - ${failures.join("; ")}`;
}

/** The three `docs/01` §8.4 checks, with the sandbox caveat spelled out. */
function reportGlobals(env: ProbeEnv, say: (line?: string) => void): void {
  say("[8] docs/01 §8.4 globals, read in the Run JavaScript evaluation global");
  say("    NOTE: that global is the MAIN WINDOW, not the plugin sandbox.");
  say(
    "    docs/01 §2.3 (measured by P0-T08 on Zotero 10.0.1) is authoritative",
  );
  say("    for the sandbox: fetch, TextDecoder, XMLHttpRequest PRESENT;");
  say("    AbortController, console, performance ABSENT. A yes below for");
  say("    AbortController does NOT contradict that and must not be relied on");
  say("    by product code; only a probe loaded as a real plugin can measure");
  say("    the sandbox, which is what P0-T08's harness did.");
  for (const [name, kind] of Object.entries(env.windowGlobals.typeofs)) {
    say(`    typeof ${name.padEnd(18)} ${kind}`);
  }
}

// --- P0-T16 path A: Zotero.HTTP + requestObserver ---------------------------

interface Tick {
  /** ms since the request was issued (Date.now(); the sandbox has no performance). */
  readonly at: number;
  /** Characters added since the previous tick. */
  readonly added: number;
  /** Cumulative characters in `xhr.response` at this tick. */
  readonly total: number;
  /** Text deltas decoded from this tick's slice. */
  readonly deltas: number;
  readonly afterAbort: boolean;
}

interface StreamRun {
  readonly ticks: readonly Tick[];
  readonly text: string;
  readonly events: number;
  /** Text deltas decoded — the real evidence that tokens, not bytes, arrived. */
  readonly deltas: number;
  readonly deltaText: string;
  /** ms from request start to the FIRST decoded text delta, or null. */
  readonly firstDeltaAt: number | null;
  readonly endSeen: boolean;
  readonly streamError: string | null;
  readonly status: number | null;
  readonly totalMs: number;
  readonly finalBodyChars: number | null;
  readonly error: unknown;
  readonly cancelledAt: number | undefined;
}

/**
 * `docs/01` §8.4.1's XHR fallback, with all three mechanics it requires.
 *
 * This deliberately does **not** go through `src/core/http/client.ts`:
 * `P0-T16`'s `Files` list does not include that file, and the facade's
 * one-shot {@link HttpResponse} is the wrong contract for a cumulative
 * `responseText`. `requestObserver` is `docs/01` §8.1's documented hook — it
 * is called with the `XMLHttpRequest` after `open()` and before `send()`,
 * which is the only moment a progress handler can be attached.
 */
async function xhrStream(
  env: ProbeEnv,
  target: StreamTarget,
  opts: {
    readonly prompt: string;
    readonly maxTokens: number;
    readonly abortAfterMs?: number;
    readonly quietPeriodMs?: number;
  },
  say: (line?: string) => void,
): Promise<StreamRun> {
  const parser = createSseParser();
  const ticks: Tick[] = [];
  const chunks: string[] = [];
  let events = 0;
  let deltaCount = 0;
  const deltaParts: string[] = [];
  let firstDeltaAt: number | null = null;
  let endSeen = false;
  let streamError: string | null = null;
  let preLength = 0;
  let cancel: (() => void) | null = null;
  let cancelledAt: number | undefined;
  let observed: XMLHttpRequest | null = null;
  const t0 = Date.now();

  const onTick = (xhr: XMLHttpRequest): void => {
    // docs/01 §8.4.1 mechanic 2: defuse the timeout from inside the handler.
    try {
      if (xhr.timeout) xhr.timeout = 0;
    } catch {
      /* some states refuse the assignment; the explicit timeout still holds */
    }
    // mechanic 3: `response` is CUMULATIVE, not a delta. Slice from a cursor.
    const text = typeof xhr.response === "string" ? xhr.response : "";
    if (text.length < preLength) return; // defensive; should never happen
    const slice = text.slice(preLength);
    preLength = text.length;
    if (slice === "") return;
    chunks.push(slice);
    let deltas = 0;
    for (const event of parser.push(slice)) {
      events++;
      const err = target.streamError(event);
      if (err !== null && streamError === null) streamError = err;
      if (target.isEnd(event)) endSeen = true;
      const d = target.delta(event);
      if (d !== null) {
        deltas++;
        deltaCount++;
        deltaParts.push(d);
        firstDeltaAt ??= Date.now() - t0;
      }
    }
    ticks.push({
      at: Date.now() - t0,
      added: slice.length,
      total: text.length,
      deltas,
      afterAbort: cancelledAt !== undefined,
    });
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = env.zotero.HTTP.request("POST", target.url("stream"), {
    body: target.body(opts.prompt, opts.maxTokens),
    headers: {
      ...target.headers(),
      "User-Agent": buildUserAgent(env.version),
      Accept: "text/event-stream",
    },
    // mechanic 1: `responseType: "text"` is MANDATORY; with "json" partial
    // responses cannot be observed at all.
    responseType: "text",
    successCodes: false,
    timeout: 180_000,
    noRetryOnThrottle: true,
    errorDelayMax: 0,
    anon: true,
    logBodyLength: 0, // never put a prompt or a key in Zotero.debug
    requestObserver: (xhr: XMLHttpRequest) => {
      observed = xhr;
      // `addEventListener`, not `xhr.onprogress = …`. The production
      // examples docs/01 §8.4.1 surveyed assign the property, but the
      // property has exactly one slot: anything http.js assigns to it after
      // `requestObserver` returns would silently replace our handler and the
      // stream would look buffered. A listener cannot be clobbered.
      xhr.addEventListener("progress", () => {
        onTick(xhr);
      });
    },
    cancellerReceiver: (c: () => void) => {
      cancel = c;
    },
  });

  if (opts.abortAfterMs !== undefined) {
    timer = setTimeout(() => {
      cancelledAt = Date.now() - t0;
      say(`    -> calling the canceller at t+${cancelledAt} ms`);
      try {
        cancel?.();
      } catch (e) {
        say(`    canceller threw: ${describeError(e)}`);
      }
    }, opts.abortAfterMs);
  }

  let status: number | null = null;
  let error: unknown;
  try {
    const xhr = await promise;
    onTick(xhr); // the last bytes may not produce a progress event
    status = xhr.status;
  } catch (e) {
    error = e;
    if (observed !== null) onTick(observed);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  const settledMs = Date.now() - t0;

  // Prove no further data arrives after the abort (P0-T17's "no further
  // progress callbacks fire"), by staying subscribed for a quiet period.
  if (opts.quietPeriodMs !== undefined) {
    const before = ticks.length;
    await sleep(opts.quietPeriodMs);
    say(
      `    quiet period ${opts.quietPeriodMs} ms after settle: ` +
        `${ticks.length - before} further progress tick(s)`,
    );
  }

  // A stream cut short by an abort can leave a complete `data:` line with no
  // blank line after it; `end()` hands that final frame over (P0-T17 asks
  // whether a partially streamed body is still readable).
  for (const e of parser.end()) {
    events++;
    const d = target.delta(e);
    if (d !== null) {
      deltaCount++;
      deltaParts.push(d);
      firstDeltaAt ??= Date.now() - t0;
    }
  }

  let finalBodyChars: number | null = null;
  if (observed !== null) {
    try {
      const o: XMLHttpRequest = observed;
      finalBodyChars =
        typeof o.response === "string" ? o.response.length : null;
    } catch {
      finalBodyChars = null;
    }
  }

  return {
    ticks,
    text: chunks.join(""),
    events,
    deltas: deltaCount,
    deltaText: deltaParts.join(""),
    firstDeltaAt,
    endSeen,
    streamError,
    status,
    totalMs: settledMs,
    finalBodyChars,
    error,
    cancelledAt,
  };
}

function reportTicks(run: StreamRun, say: (line?: string) => void): void {
  const ticks = run.ticks;
  if (ticks.length === 0) {
    say(
      "    NO progress ticks: the response arrived in one piece (or not at all)",
    );
    return;
  }
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  say(`    progress ticks: ${ticks.length}`);
  say(
    `    first byte at t+${first?.at ?? "?"} ms, last at t+${last?.at ?? "?"} ms, settle at t+${run.totalMs} ms`,
  );
  say(
    `    text deltas decoded: ${run.deltas} (${run.deltaText.length} chars), ` +
      `first delta at t+${run.firstDeltaAt ?? "never"} ms` +
      (run.firstDeltaAt === null
        ? " - the delta extractor found none; check the docs/03 §6 shape"
        : ` = ${run.totalMs - run.firstDeltaAt} ms BEFORE the response completed`),
  );
  say(
    `    incremental: ${
      ticks.length > 1 && (last?.at ?? 0) > (first?.at ?? 0)
        ? `YES - ${ticks.length} ticks spread over ${(last?.at ?? 0) - (first?.at ?? 0)} ms`
        : "NO - a single tick, i.e. buffered"
    }`,
  );
  const shown = ticks.slice(0, 12);
  for (const [i, t] of shown.entries()) {
    say(
      `      tick ${String(i + 1).padStart(2)}  t+${String(t.at).padStart(6)} ms  ` +
        `+${String(t.added).padStart(5)} chars  total ${String(t.total).padStart(6)}  ` +
        `${t.deltas} delta(s)${t.afterAbort ? "  [AFTER ABORT]" : ""}`,
    );
  }
  if (ticks.length > shown.length)
    say(`      ... ${ticks.length - shown.length} more`);
}

async function xhrStreamLeg(
  env: ProbeEnv,
  target: StreamTarget,
  say: (line?: string) => void,
): Promise<string> {
  say(
    `[9] XHR stream via Zotero.HTTP + requestObserver -> ${target.url("stream")}`,
  );
  say(
    `    ${PROVIDER_LABEL[target.provider]}, model ${target.model}, max ${STREAM_MAX_TOKENS} tokens`,
  );
  say(
    "    mechanism: Zotero.HTTP.request({ responseType: 'text', requestObserver })",
  );
  say(
    "    then xhr.onprogress, slicing xhr.response from a cursor (docs/01 §8.4.1)",
  );
  const run = await xhrStream(
    env,
    target,
    { prompt: STREAM_PROMPT, maxTokens: STREAM_MAX_TOKENS },
    say,
  );
  if (run.error !== undefined) {
    say(`    FAILED after ${run.totalMs} ms: ${describeError(run.error)}`);
    return `FAIL - ${describeError(run.error)}`;
  }
  say(
    `    HTTP ${run.status ?? "?"}, ${run.events} SSE events, end sentinel seen: ${run.endSeen ? "yes" : "no"}`,
  );
  reportTicks(run, say);
  if (run.streamError !== null) {
    // docs/03 §6.2 note 4: an error can arrive mid-stream after HTTP 200.
    say(`    MID-STREAM ERROR (HTTP 200 already sent): ${run.streamError}`);
  }
  say(`    raw stream excerpt: ${excerpt(run.text, 400)}`);
  if (run.status !== 200) return `FAIL - HTTP ${run.status ?? "?"}`;
  const ticks = run.ticks;
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  return ticks.length > 1 && (last?.at ?? 0) > (first?.at ?? 0)
    ? `PASS - incremental: ${ticks.length} ticks, first byte t+${first?.at}ms, last t+${last?.at}ms, settle t+${run.totalMs}ms`
    : `FAIL - buffered: ${ticks.length} tick(s), no partial delivery observed`;
}

// --- P0-T16 path B: fetch + ReadableStream ----------------------------------

async function fetchStreamLeg(
  env: ProbeEnv,
  target: StreamTarget,
  say: (line?: string) => void,
): Promise<string> {
  say(
    `[10] fetch stream -> ${target.url("stream")}   [main-window global only]`,
  );
  const doFetch = env.windowGlobals.fetch;
  if (doFetch === null) {
    return "SKIPPED - no fetch in the evaluation global";
  }
  const t0 = Date.now();
  let res: FetchResponseLike;
  try {
    res = await doFetch(target.url("stream"), {
      method: "POST",
      headers: {
        ...target.headers(),
        "User-Agent": buildUserAgent(env.version),
        Accept: "text/event-stream",
      },
      body: target.body(STREAM_PROMPT, STREAM_MAX_TOKENS),
    });
  } catch (e) {
    say(`    fetch threw after ${Date.now() - t0} ms: ${describeError(e)}`);
    return `FAIL - fetch threw: ${describeError(e)}`;
  }
  const body = res.body;
  const isStream = body !== null && typeof at(body, "getReader") === "function";
  say(`    HTTP ${res.status}`);
  say(
    `    check (a) res.body is a live ReadableStream: ${isStream ? "YES" : "NO"}`,
  );
  say(
    `    check (b) TextDecoderStream exists: ${
      env.windowGlobals.TextDecoderStream === null ? "NO" : "YES"
    }`,
  );
  say(
    `    check (c) AbortController aborts the channel: measured separately in [13]`,
  );
  if (!isStream) {
    const text = await res.text();
    say(`    body arrived whole: ${text.length} chars`);
    return "FAIL - res.body is not a ReadableStream; the fetch path cannot stream";
  }
  if (res.status !== 200) {
    const text = await res.text();
    say(`    body: ${excerpt(text)}`);
    return `FAIL - HTTP ${res.status}`;
  }

  const parser = createSseParser();
  const ticks: Tick[] = [];
  let total = 0;
  let events = 0;
  let deltaCount = 0;
  const deltaParts: string[] = [];
  let firstDeltaAt: number | null = null;
  let endSeen = false;
  const reader = decodedReader(body as ReadableStreamLike, env);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === "") continue;
    total += value.length;
    let deltas = 0;
    for (const event of parser.push(value)) {
      events++;
      if (target.isEnd(event)) endSeen = true;
      const d = target.delta(event);
      if (d !== null) {
        deltas++;
        deltaCount++;
        deltaParts.push(d);
        firstDeltaAt ??= Date.now() - t0;
      }
    }
    ticks.push({
      at: Date.now() - t0,
      added: value.length,
      total,
      deltas,
      afterAbort: false,
    });
  }
  const totalMs = Date.now() - t0;
  const run: StreamRun = {
    ticks,
    text: "",
    events,
    deltas: deltaCount,
    deltaText: deltaParts.join(""),
    firstDeltaAt,
    endSeen,
    streamError: null,
    status: res.status,
    totalMs,
    finalBodyChars: total,
    error: undefined,
    cancelledAt: undefined,
  };
  say(`    ${events} SSE events, end sentinel seen: ${endSeen ? "yes" : "no"}`);
  reportTicks(run, say);
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  return ticks.length > 1 && (last?.at ?? 0) > (first?.at ?? 0)
    ? `PASS [window global] - ${ticks.length} chunks, first t+${first?.at}ms, last t+${last?.at}ms`
    : `FAIL [window global] - ${ticks.length} chunk(s), no incremental delivery`;
}

/**
 * A reader yielding decoded strings. Prefers `TextDecoderStream` as `docs/01`
 * §8.4 shows; falls back to `TextDecoder`, which the sandbox does have
 * (`docs/01` §2.3), so the fallback is the one the plugin could actually use.
 */
function decodedReader(
  body: ReadableStreamLike,
  env: ProbeEnv,
): { read(): Promise<{ done: boolean; value: string }> } {
  const Ctor = env.windowGlobals.TextDecoderStream;
  if (Ctor !== null) {
    const reader = body.pipeThrough(new Ctor()).getReader();
    return {
      async read() {
        const { done, value } = await reader.read();
        return { done, value: typeof value === "string" ? value : "" };
      },
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  return {
    async read() {
      const { done, value } = await reader.read();
      if (done) return { done: true, value: decoder.decode() };
      return {
        done: false,
        value: decoder.decode(value as ArrayBufferView, { stream: true }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// P0-T17: abortion
// ---------------------------------------------------------------------------

async function xhrAbortLeg(
  env: ProbeEnv,
  target: StreamTarget | null,
  say: (line?: string) => void,
): Promise<string> {
  say(
    "[11] cancellerReceiver abort on an in-flight request (docs/01 §8.1, §8.2)",
  );
  if (target === null) {
    return "SKIPPED - no provider key entered; nothing slow enough to abort";
  }
  say(
    `    streaming ${ABORT_MAX_TOKENS} tokens from ${target.model}, cancelling at t+${ABORT_AFTER_MS} ms`,
  );
  const run = await xhrStream(
    env,
    target,
    {
      prompt: ABORT_PROMPT,
      maxTokens: ABORT_MAX_TOKENS,
      abortAfterMs: ABORT_AFTER_MS,
      quietPeriodMs: ABORT_QUIET_PERIOD_MS,
    },
    say,
  );
  reportTicks(run, say);

  const after = run.ticks.filter((t) => t.afterAbort);
  const lastAfter = after[after.length - 1];
  const cancelledAt = run.cancelledAt;
  say(`    canceller called at t+${cancelledAt ?? "never"} ms`);
  say(
    `    promise settled at  t+${run.totalMs} ms (${cancelledAt === undefined ? "-" : run.totalMs - cancelledAt} ms after the abort)`,
  );
  say(
    `    progress ticks after the abort: ${after.length}` +
      (lastAfter === undefined
        ? ""
        : `, last at t+${lastAfter.at} ms (${lastAfter.at - (cancelledAt ?? 0)} ms after the abort)`),
  );
  say(
    `    partial body still readable: ${run.finalBodyChars === null ? "no (xhr.response unreadable)" : `YES, ${run.finalBodyChars} chars`}`,
  );
  say(
    `    SSE events decoded before the abort: ${run.events}, ` +
      `${run.deltas} text delta(s), ${run.deltaText.length} chars of text`,
  );
  say(`    partial raw body excerpt: ${excerpt(run.text, 200)}`);
  say(`    partial decoded text:     ${excerpt(run.deltaText, 200)}`);

  if (run.error === undefined) {
    if (cancelledAt === undefined) {
      return (
        "INCONCLUSIVE - the stream finished before the canceller fired; " +
        "re-run with a larger token cap or a shorter abort delay"
      );
    }
    // The other possible answer to P0-T17's "rejects or resolves?": with
    // `successCodes: false` a request with no HTTP response resolves with
    // status 0 (client.ts's platform fact 1), which an abort is.
    return run.status === 0
      ? `RESOLVES (not rejects) - the promise RESOLVED with status 0 ${run.totalMs - cancelledAt} ms after the abort; ${after.length} tick(s) after it; ${run.finalBodyChars ?? 0} chars of partial body readable`
      : `INCONCLUSIVE - the promise RESOLVED with HTTP ${run.status ?? "?"} after the abort; the generation may have finished first`;
  }
  const e = run.error;
  const name = e instanceof Error ? e.name : typeof e;
  const isCancelled = e instanceof env.zotero.HTTP.CancelledException;
  say(`    rejection: ${describeError(e)}`);
  say(
    `    instanceof Zotero.HTTP.CancelledException: ${isCancelled ? "YES" : "NO"}`,
  );
  for (const cls of [
    "CancelledException",
    "TimeoutException",
    "BrowserOfflineException",
    "SecurityException",
    "UnexpectedStatusException",
  ] as const) {
    say(
      `      instanceof Zotero.HTTP.${cls.padEnd(26)} ${e instanceof env.zotero.HTTP[cls] ? "yes" : "no"}`,
    );
  }
  return isCancelled
    ? `PASS - rejected with Zotero.HTTP.CancelledException ${run.totalMs - (cancelledAt ?? 0)} ms after the abort; ${after.length} tick(s) after it; ${run.finalBodyChars ?? 0} chars of partial body readable`
    : `PARTIAL - rejected with ${name}, NOT CancelledException; see the instanceof table`;
}

/**
 * The same abort, but through `src/core/http/client.ts`'s `onCanceller`, to
 * see which {@link HttpError} code the facade produces. `P0-T17`'s **Do NOT**
 * forbids treating cancellation as a generic error, and `docs/07` §10.1 makes
 * it a distinct outcome, so the mapping is worth measuring rather than
 * assuming.
 */
async function clientAbortLeg(
  client: HttpClient,
  target: StreamTarget | null,
  say: (line?: string) => void,
): Promise<string> {
  say("[12] the same abort through src/core/http/client.ts (onCanceller)");
  if (target === null) {
    return "SKIPPED - no provider key entered";
  }
  let cancel: (() => void) | null = null;
  const t0 = Date.now();
  const timer = setTimeout(() => {
    say(`    -> calling the canceller at t+${Date.now() - t0} ms`);
    cancel?.();
  }, ABORT_AFTER_MS);
  const x = await timed(() =>
    client.request("POST", target.url("stream"), {
      headers: target.headers(),
      body: target.body(ABORT_PROMPT, ABORT_MAX_TOKENS),
      timeoutMs: 180_000,
      onCanceller: (c) => {
        cancel = c;
      },
    }),
  );
  clearTimeout(timer);
  if (x.response) {
    say(`    the promise RESOLVED: HTTP ${x.response.status} after ${x.ms} ms`);
    return `INCONCLUSIVE - resolved with HTTP ${x.response.status}; the abort did not take effect`;
  }
  say(`    ${describeError(x.error)}`);
  const e = x.error;
  if (e instanceof HttpError) {
    return e.code === "CANCELLED"
      ? `PASS - HttpError code CANCELLED (source ${e.source}), retryable ${String(e.retryable)}, after ${x.ms} ms`
      : `PARTIAL - HttpError code ${e.code} (source ${e.source}); docs/07 §10.1 wants a distinct cancellation outcome`;
  }
  return `PARTIAL - the facade rethrew an unmapped error: ${describeError(e)}`;
}

async function fetchAbortLeg(
  env: ProbeEnv,
  target: StreamTarget,
  say: (line?: string) => void,
): Promise<string> {
  say("[13] docs/01 §8.4 check (c): AbortController on the fetch path");
  say(
    "     [main-window global only - docs/01 §2.3 measured the plugin sandbox",
  );
  say("      as having NO AbortController, so the product answer is n/a]");
  const doFetch = env.windowGlobals.fetch;
  const AC = env.windowGlobals.AbortController;
  if (doFetch === null || AC === null) {
    return "n/a - no fetch or no AbortController even in the window global";
  }
  const controller = new AC();
  const t0 = Date.now();
  let abortedAt = 0;
  const timer = setTimeout(() => {
    abortedAt = Date.now() - t0;
    say(`    -> controller.abort() at t+${abortedAt} ms`);
    controller.abort();
  }, ABORT_AFTER_MS);

  let chunks = 0;
  let lastChunkAt = 0;
  let thrown: unknown;
  try {
    const res = await doFetch(target.url("stream"), {
      method: "POST",
      headers: {
        ...target.headers(),
        "User-Agent": buildUserAgent(env.version),
        Accept: "text/event-stream",
      },
      body: target.body(ABORT_PROMPT, ABORT_MAX_TOKENS),
      signal: controller.signal,
    });
    const body = res.body;
    if (body === null || typeof at(body, "getReader") !== "function") {
      clearTimeout(timer);
      return "n/a - res.body is not a ReadableStream on this path";
    }
    const reader = decodedReader(body as ReadableStreamLike, env);
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
      chunks++;
      lastChunkAt = Date.now() - t0;
    }
  } catch (e) {
    thrown = e;
  } finally {
    clearTimeout(timer);
  }
  const settled = Date.now() - t0;
  say(
    `    chunks read: ${chunks}, last at t+${lastChunkAt} ms, settled t+${settled} ms`,
  );
  if (thrown === undefined) {
    return `INCONCLUSIVE [window global] - the read loop ended without throwing (${chunks} chunks)`;
  }
  const name = thrown instanceof Error ? thrown.name : typeof thrown;
  say(`    threw: ${describeError(thrown)}`);
  return (
    `YES [window global] - aborted ${settled - abortedAt} ms after abort(), ` +
    `rejection ${name}; NOT available in the plugin sandbox (docs/01 §2.3)`
  );
}

// ---------------------------------------------------------------------------
// P0-T35: cancellation AFTER the first byte (what P0-T17 could not reach)
// ---------------------------------------------------------------------------

interface MidStreamResult {
  readonly verdict: string;
  /** When the first progress event fired, so leg [15] can abort after it. */
  readonly firstTickAt: number | null;
}

/**
 * `P0-T17` verified the cancellation primitive and said plainly what it did not
 * establish. This leg fixes the one thing that was wrong with it: the abort is
 * triggered by the Nth **progress event**, not by a timer, so data has
 * demonstrably arrived before the cancel.
 *
 * It reports **three independent answers**, because any of them can be false on
 * its own and Phase 3's job engine needs to know which:
 *   (a) does the cancel take effect once bytes are in flight,
 *   (b) is the partial body still readable afterwards,
 *   (c) do further progress events arrive during a quiet period.
 */
async function midStreamAbortLeg(
  env: ProbeEnv,
  say: (line?: string) => void,
): Promise<MidStreamResult> {
  say(
    `[14] P0-T35: abort on progress event #${MIDSTREAM_ABORT_AFTER_TICKS} - ` +
      `cancellation AFTER data has arrived (keyless)`,
  );
  say(`    GET ${MIDSTREAM_URL}`);

  const t0 = Date.now(); // docs/01 §2.3: no `performance` in the sandbox
  const ticks: { at: number; total: number; afterAbort: boolean }[] = [];
  let cancel: (() => void) | null = null;
  let cancelledAt: number | undefined;
  let bodyAtCancel: number | null = null;
  // A ref rather than a `let`: TypeScript does not track assignments made inside a
  // callback, so a `let` initialised to null narrows to `null` and reading
  // `.response` off it fails to compile.
  const observed: { current: XMLHttpRequest | null } = { current: null };

  const onTick = (xhr: XMLHttpRequest): void => {
    const total = typeof xhr.response === "string" ? xhr.response.length : 0;
    ticks.push({
      at: Date.now() - t0,
      total,
      afterAbort: cancelledAt !== undefined,
    });
    if (
      cancelledAt === undefined &&
      ticks.length >= MIDSTREAM_ABORT_AFTER_TICKS &&
      total > 0
    ) {
      cancelledAt = Date.now() - t0;
      bodyAtCancel = total;
      say(
        `    -> ${ticks.length} progress event(s), ${total} chars buffered; ` +
          `calling the canceller at t+${cancelledAt} ms`,
      );
      try {
        cancel?.();
      } catch (e) {
        say(`    canceller threw: ${describeError(e)}`);
      }
    }
  };

  const promise = env.zotero.HTTP.request("GET", MIDSTREAM_URL, {
    headers: {
      "User-Agent": buildUserAgent(env.version),
      Accept: "application/json",
    },
    // mechanic 1 from P0-T16: `responseType: "text"` is MANDATORY. With
    // "json" a partial response cannot be observed at all, which is the
    // whole measurement here.
    responseType: "text",
    successCodes: false,
    timeout: 180_000,
    noRetryOnThrottle: true,
    errorDelayMax: 0,
    anon: true,
    logBodyLength: 0,
    requestObserver: (xhr: XMLHttpRequest) => {
      observed.current = xhr;
      // addEventListener, not xhr.onprogress: the property has one slot and
      // http.js may assign to it after requestObserver returns (P0-T16).
      xhr.addEventListener("progress", () => {
        onTick(xhr);
      });
    },
    cancellerReceiver: (c: () => void) => {
      cancel = c;
    },
  });

  let error: unknown;
  let status: number | null = null;
  try {
    const xhr = await promise;
    onTick(xhr); // the last bytes may not produce a progress event
    status = xhr.status;
  } catch (e) {
    error = e;
  }
  const settledMs = Date.now() - t0;

  // (b) is the partial body still readable through the SAME xhr afterwards?
  let readableAfter: number | null = null;
  try {
    const o = observed.current;
    const r: unknown = o === null ? null : o.response;
    readableAfter = typeof r === "string" ? r.length : null;
  } catch (e) {
    say(`    reading xhr.response after the abort threw: ${describeError(e)}`);
  }

  // (c) does anything more arrive once we stay subscribed?
  const beforeQuiet = ticks.length;
  await sleep(ABORT_QUIET_PERIOD_MS);
  const duringQuiet = ticks.length - beforeQuiet;

  const first = ticks[0];
  const firstTickAt = first?.at ?? null;
  say(
    `    progress events: ${ticks.length} total, first at t+${firstTickAt ?? "never"} ms`,
  );
  say(`    canceller called at t+${cancelledAt ?? "never"} ms`);
  say(
    `    settled at t+${settledMs} ms` +
      (cancelledAt === undefined
        ? ""
        : ` (${settledMs - cancelledAt} ms after the abort)`),
  );
  say(
    `    (a) buffered at the moment of cancellation: ${bodyAtCancel ?? 0} chars`,
  );
  say(
    `    (b) partial body readable afterwards: ` +
      (readableAfter === null
        ? "NO (xhr.response unreadable)"
        : `YES, ${readableAfter} chars`),
  );
  say(
    `    (c) further progress events in ${ABORT_QUIET_PERIOD_MS} ms quiet period: ${duringQuiet}`,
  );
  if (error !== undefined) say(`    threw: ${describeError(error)}`);

  // Honest failure modes first (plan/README.md §5 rule 6): if the body arrived
  // in fewer events than the trigger needs, nothing mid-stream was exercised
  // and saying so is the result.
  if (cancelledAt === undefined) {
    return {
      firstTickAt,
      verdict:
        `INCONCLUSIVE - the canceller never fired: only ${ticks.length} progress ` +
        `event(s) with content, fewer than the ${MIDSTREAM_ABORT_AFTER_TICKS} the trigger ` +
        `needs. The body arrived too fast or in one piece; a larger response is required.`,
    };
  }
  if (error === undefined) {
    return {
      firstTickAt,
      verdict:
        `INCONCLUSIVE - the request RESOLVED with HTTP ${status ?? "?"} despite a cancel at ` +
        `t+${cancelledAt} ms with ${bodyAtCancel ?? 0} chars buffered: the abort did not take effect`,
    };
  }
  const cancelledException =
    error instanceof Error && error.name === "CancelledException";
  const answers =
    `(a) stopped ${settledMs - cancelledAt} ms after the abort with ${bodyAtCancel ?? 0} chars in hand; ` +
    `(b) partial body ${readableAfter === null ? "NOT readable" : `readable, ${readableAfter} chars`}; ` +
    `(c) ${duringQuiet} further event(s) in ${ABORT_QUIET_PERIOD_MS} ms`;
  return {
    firstTickAt,
    verdict:
      (duringQuiet === 0 ? "PASS" : "PARTIAL") +
      ` - ${cancelledException ? "CancelledException" : describeError(error)}; ` +
      answers,
  };
}

/**
 * The same mid-stream abort through `src/core/http/client.ts`, to confirm that
 * the status-0 resolve still maps to `CANCELLED` rather than `NETWORK` **when
 * bytes have already arrived** — the case the `cancelRequested` flag was written
 * for and which `P0-T17` could only test before the first byte.
 *
 * The facade exposes no progress hook, so the abort is scheduled from leg [14]'s
 * **measured** first-tick time rather than from a guess. That is weaker evidence
 * than an event trigger and is reported as such.
 */
async function midStreamClientAbortLeg(
  client: HttpClient,
  firstTickAt: number | null,
  say: (line?: string) => void,
): Promise<string> {
  say(
    "[15] P0-T35: the same mid-stream abort through HttpClient (onCanceller)",
  );
  if (firstTickAt === null) {
    return "SKIPPED - leg [14] saw no progress event, so there is no measured abort point";
  }
  const abortAt = firstTickAt + MIDSTREAM_FACADE_MARGIN_MS;
  say(
    `    aborting at t+${abortAt} ms - leg [14] measured the first byte at ` +
      `t+${firstTickAt} ms, plus a ${MIDSTREAM_FACADE_MARGIN_MS} ms margin`,
  );
  let cancel: (() => void) | null = null;
  const t0 = Date.now();
  const timer = setTimeout(() => {
    say(`    -> calling the canceller at t+${Date.now() - t0} ms`);
    cancel?.();
  }, abortAt);
  const x = await timed(() =>
    client.request("GET", MIDSTREAM_URL, {
      headers: { Accept: "application/json" },
      timeoutMs: 180_000,
      onCanceller: (c) => {
        cancel = c;
      },
    }),
  );
  clearTimeout(timer);
  if (x.response) {
    say(`    the promise RESOLVED: HTTP ${x.response.status} after ${x.ms} ms`);
    return (
      `INCONCLUSIVE - resolved with HTTP ${x.response.status} after ${x.ms} ms; ` +
      `the whole body arrived before t+${abortAt} ms, so nothing was aborted mid-stream`
    );
  }
  say(`    ${describeError(x.error)}`);
  const e = x.error;
  if (e instanceof HttpError) {
    return e.code === "CANCELLED"
      ? `PASS - HttpError code CANCELLED (source ${e.source}), retryable ${String(e.retryable)}, after ${x.ms} ms; the mapping holds with bytes already delivered`
      : `FAIL - HttpError code ${e.code} (source ${e.source}): docs/07 §10.1 wants CANCELLED, and a mid-stream cancel is exactly what cancelRequested exists to disambiguate from NETWORK`;
  }
  return `PARTIAL - the facade rethrew an unmapped error: ${describeError(e)}`;
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
 * A credential-bearing header (`Authorization`, `x-api-key`,
 * `x-goog-api-key`) is reported as present/absent and whether it equals what
 * was typed — never its value, per `docs/09` §2.1 level 3. `Cookie` should be
 * absent (`anon: true`).
 */
function reportSentHeaders(
  xhr: HttpTransportXhr | undefined,
  env: ProbeEnv,
  say: (line?: string) => void,
  spec: {
    readonly show: readonly string[];
    readonly secretHeaders: readonly {
      name: string;
      expected: string | null;
    }[];
  },
): void {
  const read = channelHeaderReader(xhr, env.interfaces);
  if (typeof read === "string") {
    say(`    sent headers: unavailable (${read})`);
    return;
  }
  for (const name of spec.show)
    say(`    sent ${name}: ${read(name) ?? "(absent)"}`);
  for (const { name, expected } of spec.secretHeaders) {
    const value = read(name);
    say(
      `    sent ${name}: ${
        value === undefined
          ? "(absent)"
          : expected === null
            ? "present (value withheld)"
            : `present, matches what was typed: ${value === expected ? "yes" : "NO"}`
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

function sayStatus(
  r: HttpResponse,
  ms: number,
  doc: unknown,
  say: (line?: string) => void,
): void {
  say(
    `    status ${r.status}, ${ms} ms, ${r.body.length} chars, ` +
      `complete JSON: ${doc === undefined ? "NO" : "yes"}, ` +
      `content-type ${r.header("content-type") ?? "-"}`,
  );
}

function reportHttpError(
  r: HttpResponse,
  doc: unknown,
  messagePath: readonly string[],
  say: (line?: string) => void,
): string {
  const message = str(at(doc, ...messagePath));
  say(`    error.message: ${message ?? "-"}`);
  say(
    `    error.type/code: ${String(at(doc, "error", "type") ?? at(doc, "error", "code") ?? "-")}`,
  );
  say(`    body: ${excerpt(r.body)}`);
  if (r.status === 401 || r.status === 403) {
    return `FAIL - HTTP ${r.status}: auth header rejected (key invalid, or the header did not arrive)`;
  }
  return `FAIL - HTTP ${r.status}: ${message ?? "see body"}`;
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Replace every typed secret, then `docs/09` §2.1's `KEY_PATTERNS` — spelled
 * with character classes so `P0-T15`'s leak grep does not match this source
 * file. The catch-all long-opaque-run pattern is deliberately included: a
 * false-positive redaction costs a debugging inconvenience, a false negative
 * publishes a billing credential.
 */
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s !== "") out = out.split(s).join(`[redacted:${s.length}]`);
  }
  const patterns: readonly RegExp[] = [
    /\bsk[-]ant[-][A-Za-z0-9_-]{20,}/g, // Anthropic
    /\bsk[-]or[-]v1[-][A-Za-z0-9]{32,}/g, // OpenRouter
    /\bsk[-]proj[-][A-Za-z0-9_-]{20,}/g, // OpenAI project keys
    /\bsk[-][A-Za-z0-9]{32,}/g, // OpenAI legacy
    /\bAIza[A-Za-z0-9_-]{35}/g, // Google
    /\b(Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/gi, // any bearer token
  ];
  for (const re of patterns) {
    out = out.replace(re, (m) =>
      /^bearer/i.test(m) ? "Bearer [redacted]" : `[redacted:${m.length}]`,
    );
  }
  return out;
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

/** Globals the block reports `typeof` for, in the evaluation global. */
const REPORTED_GLOBALS: readonly string[] = [
  "fetch",
  "AbortController",
  "TextDecoderStream",
  "ReadableStream",
  "TextDecoder",
  "XMLHttpRequest",
  "console",
  "performance",
  "structuredClone",
  "queueMicrotask",
];

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

  const typeofs = REPORTED_GLOBALS.map(
    (name) => `    ${JSON.stringify(name)}: typeof ${name},`,
  ).join("\n");

  process.stdout.write(
    [
      "// research_helper network probe: P0-T15 (V-7), P0-T16 (V-8), P0-T17 (V-9),",
      "// P0-T35 (V-9 mid-stream). Legs [14] and [15] are KEYLESS: cancel every",
      "// password dialog and they still run.",
      `// Generated ${new Date().toISOString()} from scripts/spike-network.ts, version ${version}.`,
      "// Tools > Developer > Run JavaScript: paste, make sure 'Run as async function'",
      "// is checked, press Run. Four password dialogs ask for the four provider keys,",
      "// in the order OpenRouter, OpenAI, Gemini, Anthropic. Cancel skips one provider.",
      "// Never type a key into this editor. Nothing here needs editing.",
      ascii.trimEnd(),
      "return await RHSpikeNetwork.main({",
      "  zotero: Zotero,",
      "  services: Services,",
      '  interfaces: typeof Ci !== "undefined" ? Ci : Components.interfaces,',
      `  version: ${JSON.stringify(version)},`,
      "  windowGlobals: {",
      "    typeofs: {",
      typeofs,
      "    },",
      '    fetch: typeof fetch === "function" ? fetch.bind(globalThis) : null,',
      '    AbortController: typeof AbortController === "function" ? AbortController : null,',
      '    TextDecoderStream: typeof TextDecoderStream === "function" ? TextDecoderStream : null,',
      "  },",
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

/**
 * `scripts/record-fixtures.ts`'s redaction pass — `docs/13` §3.2, as `P2-T33`
 * extended it.
 *
 * **What this pins.** The maintainer address must leave a fixture in **both**
 * spellings a service has echoed it in: plain (`request.email`) and
 * percent-encoded with `%40` for `@` (`nextPageUrl`). Measured by `P2-T03` on
 * 2026-10-14 against Europe PMC, where the plain-only scrub left the encoded
 * form in six fixtures. The scrub (`redactExchange`) and the abort
 * (`assertClean`) are tested separately, because either one alone would let a
 * fixture through: a scrub that misses a spelling is caught by the abort, and
 * an abort that misses a spelling would let a scrub regression write a file.
 *
 * Layer 1 (`docs/13` §2.1): plain Node, no network. Only the `--rescrub`
 * tests write, and only into a fresh temporary directory they remove. The
 * deny-list is built from an explicit, empty environment so nothing here
 * depends on the shell the suite runs in.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ADDRESS_PLACEHOLDER,
  assertClean,
  assertCleanTtsFixture,
  AUDIO_SCRIPT_STAND_IN_PROVIDER,
  AUDIO_SCRIPT_STAND_IN_TEXT,
  audioScriptPrompt,
  audioScriptRequest,
  chooseLlmModel,
  chooseTtsModel,
  fixtureDirFor,
  invalidLlmKey,
  isAudioScriptScenario,
  isLlmRecordableProvider,
  isTtsRecordableSource,
  literalDenyList,
  LLM_AUDIO_SCRIPT_SCENARIOS,
  LLM_EXIT_SPEND_GATE,
  LLM_KEY_ENV_VARS,
  LLM_RECORDABLE_PROVIDERS,
  LLM_SCENARIOS,
  llmFixtureDirFor,
  llmKeyFromEnvironment,
  llmPriceSource,
  llmScenarioRequest,
  MAINTAINER_ADDRESS_SPELLINGS,
  type Mode,
  parseCliArgs,
  pcmTone,
  RECORDABLE_SOURCES,
  redactExchange,
  rescrubFixtures,
  runLlmRecorder,
  runTtsRecorder,
  selectLlmScenarios,
  selectTtsScenarios,
  standInMayBeWritten,
  stateLlmSpend,
  stateTtsSpend,
  stripEmailAddresses,
  TTS_AUDIO_TOKENS_PER_SECOND,
  TTS_DOCUMENTED_PRICES,
  TTS_MAX_BODY_BYTES,
  TTS_PCM_MIME_TYPE,
  TTS_SCENARIOS,
  TTS_SECONDS_BOUND,
  TTS_STAND_IN_SECONDS,
  TTS_TEXTS,
  TTS_UNKNOWN_MODEL,
  TTS_VOICE,
  ttsAudioTokens,
  ttsFixtureDirFor,
  ttsRequestBody,
  UsageError,
  usdUp,
} from "../../../scripts/record-fixtures";
import { createManualClock } from "../../../src/core/clock";
import { KEYISH_FIELD, redact } from "../../../src/core/errors";
import type {
  HttpExceptionClass,
  HttpTransport,
  HttpTransportXhr,
} from "../../../src/core/http/client";
import { MAINTAINER_EMAIL } from "../../../src/core/http/userAgent";
import { modelsFor } from "../../../src/llm/shared/modelCatalogue";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import { requestEstimate } from "../../../src/pipeline/shared/budget";

const PLAIN = MAINTAINER_EMAIL;
const ENCODED = encodeURIComponent(MAINTAINER_EMAIL);
const PLACEHOLDER = "[redacted:maintainer-address]";

/** The shape Europe PMC answers with: the address echoed twice, two ways. */
function europePmcBody(): string {
  return JSON.stringify({
    version: "6.9",
    hitCount: 4186,
    request: { queryString: "CRISPR AND editing", email: PLAIN },
    nextPageUrl:
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=CRISPR" +
      `&cursorMark=AoIIQDGUpSg1MTQ2NzgxMA%3D%3D&email=${ENCODED}`,
    resultList: { result: [] },
  });
}

describe("record-fixtures redaction — the maintainer address, both spellings", () => {
  it("the encoded spelling really is a different string, and both are on the deny-list", () => {
    expect(ENCODED).not.toBe(PLAIN);
    expect(ENCODED).toContain("%40");
    expect(MAINTAINER_ADDRESS_SPELLINGS).toEqual(
      expect.arrayContaining([PLAIN, ENCODED]),
    );
    // With no environment, the deny-list is exactly the two spellings.
    expect([...literalDenyList({})].sort()).toEqual([PLAIN, ENCODED].sort());
  });

  it("redactExchange scrubs the percent-encoded address from the body (nextPageUrl)", () => {
    const deny = literalDenyList({});
    const raw = { status: 200, headers: {}, body: europePmcBody() };
    expect(raw.body).toContain(ENCODED);

    const { exchange, notes } = redactExchange(raw, deny);

    expect(exchange.body).not.toContain(ENCODED);
    expect(exchange.body).not.toContain(PLAIN);
    expect(exchange.body).not.toMatch(/%40/u);
    // Both occurrences became the one placeholder, nothing else moved.
    expect(exchange.body.split(PLACEHOLDER)).toHaveLength(3);
    expect(exchange.body).toBe(
      raw.body.split(PLAIN).join(PLACEHOLDER).split(ENCODED).join(PLACEHOLDER),
    );
    expect(notes).toContain("scrubbed body");
    expect(notes).toContain("scrubbed body: percent-encoded contact address");
  });

  it("redactExchange scrubs the percent-encoded address from a header value too", () => {
    const deny = literalDenyList({});
    const { exchange, notes } = redactExchange(
      {
        status: 200,
        headers: { Link: `<https://x.test/next?email=${ENCODED}>; rel="next"` },
        body: "{}",
      },
      deny,
    );
    expect(exchange.headers["link"]).toBe(
      `<https://x.test/next?email=${PLACEHOLDER}>; rel="next"`,
    );
    expect(notes).toContain("scrubbed header link");
    expect(notes).not.toContain("scrubbed body");
    expect(notes).not.toContain(
      "scrubbed body: percent-encoded contact address",
    );
  });

  it("assertClean refuses the percent-encoded spelling, naming the address and not quoting it", () => {
    const deny = literalDenyList({});
    const text = `{"nextPageUrl":"https://x.test/?email=${ENCODED}"}`;
    expect(() => assertClean("search-typical", text, deny)).toThrow(
      /Refusing to write fixture "search-typical": it still contains the maintainer address/u,
    );
    expect(() => assertClean("search-typical", text, deny)).not.toThrow(
      new RegExp(ENCODED.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  });

  it("assertClean refuses the plain spelling as before, and upper-case %40 hex as well", () => {
    const deny = literalDenyList({});
    expect(() =>
      assertClean("s", `{"request":{"email":"${PLAIN}"}}`, deny),
    ).toThrow(/the maintainer address/u);
    const [local, domain] = PLAIN.split("@");
    expect(() =>
      assertClean(
        "s",
        `${String(local)}%40${String(domain)}`.toUpperCase(),
        deny,
      ),
    ).toThrow(/the maintainer address/u);
  });

  it("the scrubbed Europe PMC body passes assertClean — the two halves agree", () => {
    const deny = literalDenyList({});
    const { exchange } = redactExchange(
      { status: 200, headers: {}, body: europePmcBody() },
      deny,
    );
    expect(() =>
      assertClean("search-typical", JSON.stringify(exchange), deny),
    ).not.toThrow();
  });

  it("a key-shaped environment value is still scrubbed literally, whatever its length", () => {
    const deny = literalDenyList({ RH_TEST_API_KEY: "abcdefghijklmnop" });
    expect(deny).toContain("abcdefghijklmnop");
    const { exchange } = redactExchange(
      { status: 200, headers: {}, body: '{"k":"abcdefghijklmnop"}' },
      deny,
    );
    expect(exchange.body).toBe('{"k":"[redacted:env-secret]"}');
    expect(() => assertClean("s", '{"k":"abcdefghijklmnop"}', deny)).toThrow(
      /a value from the environment survived redaction/u,
    );
  });
});

/**
 * Every email address, not only the maintainer's — the owner's decision of
 * 2026-10-16 (`plan/00` §6 item 224, `docs/13` §3.2). Recorded PubMed and
 * Europe PMC affiliation fields carried 390 authors' contact addresses in 29
 * committed fixtures; `--rescrub` replaced them by the same pass.
 */
describe("record-fixtures redaction — every email address (item 224)", () => {
  const ADDRESS = ADDRESS_PLACEHOLDER;

  it("replaces an address in a PubMed <Affiliation> and counts it in the notes", () => {
    const body =
      "<Affiliation>Dept. of X, Boston, MA, USA. jane.doe@hospital.example.org.</Affiliation>" +
      "<Affiliation>Electronic address: J.Roe@Uni-Heidelberg.DE.</Affiliation>";
    const { exchange, notes } = redactExchange(
      { status: 200, headers: {}, body },
      literalDenyList({}),
    );
    expect(exchange.body).toBe(
      `<Affiliation>Dept. of X, Boston, MA, USA. ${ADDRESS}.</Affiliation>` +
        `<Affiliation>Electronic address: ${ADDRESS}.</Affiliation>`,
    );
    expect(notes).toContain("scrubbed body");
    expect(notes).toContain("scrubbed body: 2 email address(es)");
  });

  it("keeps the maintainer placeholder for the maintainer address", () => {
    const body = `{"email":"${PLAIN}","affiliation":"Lab, Seoul. a.b@kist.re.kr"}`;
    const { exchange } = redactExchange(
      { status: 200, headers: {}, body },
      literalDenyList({}),
    );
    expect(exchange.body).toBe(
      `{"email":"${PLACEHOLDER}","affiliation":"Lab, Seoul. ${ADDRESS}"}`,
    );
  });

  it("never eats a JSON escape's letter, so a JSON body still parses", () => {
    const body = JSON.stringify({ a: "line one\nnobody@example.org\tx@y.com" });
    expect(body).toContain("\\nnobody@");
    const { exchange } = redactExchange(
      { status: 200, headers: {}, body },
      literalDenyList({}),
    );
    expect(JSON.parse(exchange.body)).toEqual({
      a: `line one\n${ADDRESS}\t${ADDRESS}`,
    });
  });

  it("matches the percent-encoded spelling, in a header value too", () => {
    const { exchange, notes } = redactExchange(
      {
        status: 200,
        headers: { Link: "<https://x.test/?contact=someone%40example.org>" },
        body: "{}",
      },
      literalDenyList({}),
    );
    expect(exchange.headers["link"]).toBe(
      `<https://x.test/?contact=${ADDRESS}>`,
    );
    expect(notes).toContain("scrubbed header link: 1 email address(es)");
  });

  it("keeps the medRxiv Java identity strings, which are not addresses", () => {
    const text =
      "View larger version (23K):\\norg.highwire.dtl.DTLVardef@ebf121org.highwire.dtl.DTLVardef@19ab8a1org";
    expect(stripEmailAddresses(text)).toEqual({ text, count: 0 });
  });

  it("assertClean refuses a surviving address, without quoting it", () => {
    const deny = literalDenyList({});
    const text = '{"affiliation":"Paris. someone@inserm.fr."}';
    expect(() => assertClean("record-rich", text, deny)).toThrow(
      /Refusing to write fixture "record-rich": it still contains an email address/u,
    );
    expect(() => assertClean("record-rich", text, deny)).not.toThrow(
      /someone/u,
    );
    expect(() =>
      assertClean(
        "record-rich",
        text.replace("someone@inserm.fr", ADDRESS),
        deny,
      ),
    ).not.toThrow();
  });

  it("no committed fixture of any source still carries an address", async () => {
    let read = 0;
    for (const source of RECORDABLE_SOURCES) {
      const dir = fixtureDirFor(source);
      for (const name of await readdir(dir)) {
        if (!name.endsWith(".json") || name.endsWith("_meta.json")) continue;
        const stored = JSON.parse(await readFile(`${dir}/${name}`, "utf8")) as {
          headers: Record<string, string>;
          body: string;
        };
        for (const part of [stored.body, ...Object.values(stored.headers)]) {
          expect(stripEmailAddresses(part).count, `${source}/${name}`).toBe(0);
        }
        read += 1;
      }
    }
    expect(read).toBeGreaterThan(100);
  });
});

describe("record-fixtures --rescrub (item 224)", () => {
  const KEY = "0123456789abcdef";
  const META = {
    scenario: "record-rich",
    scenarioVersion: 1,
    recordedAt: "2026-10-07T00:00:00.000Z",
    endpoint: "https://x.test/",
    method: "GET",
    toolVersion: "t",
    synthetic: false,
    redactions: ["scrubbed body"],
  };

  async function fixtureDir(exchange: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rh-rescrub-"));
    await writeFile(
      `${dir}/${KEY}.json`,
      `${JSON.stringify(exchange, null, 2)}\n`,
    );
    await writeFile(
      `${dir}/${KEY}_meta.json`,
      `${JSON.stringify(META, null, 2)}\n`,
    );
    return dir;
  }

  it("rewrites only the addresses, keeps the key and recordedAt, notes the count, and is idempotent", async () => {
    const dir = await fixtureDir({
      status: 200,
      headers: { "content-type": "text/xml" },
      body: "<A>Rome. x@y.it.</A>",
    });
    try {
      const first = await rescrubFixtures(
        { fixtureDir: dir },
        [],
        "2026-10-16",
      );
      expect(first).toEqual({ read: 1, changed: [KEY], addresses: 1 });
      const stored = JSON.parse(
        await readFile(`${dir}/${KEY}.json`, "utf8"),
      ) as { body: string };
      expect(stored.body).toBe(`<A>Rome. ${ADDRESS_PLACEHOLDER}.</A>`);
      const meta = JSON.parse(
        await readFile(`${dir}/${KEY}_meta.json`, "utf8"),
      ) as typeof META;
      expect(meta.recordedAt).toBe(META.recordedAt);
      expect(meta.redactions).toEqual([
        "scrubbed body",
        "re-scrubbed 2026-10-16 without a request (plan/00 item 224): scrubbed body: 1 email address(es)",
      ]);
      expect((await readdir(dir)).sort()).toEqual([
        `${KEY}.json`,
        `${KEY}_meta.json`,
      ]);
      const second = await rescrubFixtures(
        { fixtureDir: dir },
        [],
        "2026-10-16",
      );
      expect(second).toEqual({ read: 1, changed: [], addresses: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses when the pass would change anything other than an address", async () => {
    const longRun = "A".repeat(48);
    const dir = await fixtureDir({
      status: 200,
      headers: {},
      body: `{"token":"${longRun}","a":"x@y.it"}`,
    });
    try {
      await expect(
        rescrubFixtures({ fixtureDir: dir }, [], "2026-10-16"),
      ).rejects.toThrow(/would change more than email addresses/u);
      expect(await readFile(`${dir}/${KEY}.json`, "utf8")).toContain(longRun);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// P3-T30 — the LLM recorder (split by plan/00 §6 item 298(b)): its gates, its
// redaction, its stated spend. Every run below goes to a fake transport in a
// fresh temporary directory; no test reads process.env, and none can reach
// the network: the fake answers from memory and records what it was asked.
// ===========================================================================

/** A provider-shaped key, synthetic, assembled at run time (never a literal). */
function syntheticSessionKey(): string {
  return ["sk", "proj", `sessionkeyforatest${"Q".repeat(30)}`].join("-");
}

interface FakeCall {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string | undefined;
}

interface FakeAnswer {
  readonly status: number;
  readonly body: string;
  readonly headers?: string;
}

interface FakeOpenAi {
  readonly factory: () => HttpTransport;
  readonly calls: FakeCall[];
  readonly created: () => number;
}

/**
 * A fake `Zotero.HTTP` answering like OpenAI's Responses API: the model list
 * on GET, a 401 for the recorder's invalid key, a small answer otherwise.
 * `answer` may override any other POST answer.
 */
function fakeOpenAi(
  options: {
    readonly listed?: readonly string[];
    readonly answer?: (call: FakeCall) => FakeAnswer | undefined;
  } = {},
): FakeOpenAi {
  const calls: FakeCall[] = [];
  let created = 0;
  class Stub extends Error {}
  const headerBlock =
    "content-type: application/json\r\nopenai-organization: org-synthetic\r\n" +
    "openai-project: proj_synthetic\r\nset-cookie: __cf_bm=synthetic; path=/\r\n" +
    "x-request-id: req_synthetic\r\nx-ratelimit-remaining-requests: 499";
  const ok = JSON.stringify({
    id: "resp_synthetic",
    object: "response",
    status: "completed",
    model: "gpt-5.6-luna",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "ready" }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
  });
  const factory = (): HttpTransport => {
    created += 1;
    return {
      request(method, url, opts): Promise<HttpTransportXhr> {
        const call: FakeCall = {
          method,
          url,
          authorization: opts.headers?.["Authorization"],
          body: opts.body,
        };
        calls.push(call);
        let answer: FakeAnswer;
        if (method === "GET") {
          answer = {
            status: 200,
            body: JSON.stringify({
              object: "list",
              data: (options.listed ?? ["gpt-5.6-luna", "gpt-5.6-terra"]).map(
                (id) => ({
                  id,
                  object: "model",
                  created: 1,
                  owned_by: "openai",
                }),
              ),
            }),
          };
        } else if (
          call.authorization?.includes(invalidLlmKey("openai")) === true
        ) {
          answer = {
            status: 401,
            body: JSON.stringify({
              error: {
                message: "Incorrect API key provided.",
                type: "invalid_request_error",
                param: null,
                code: "invalid_api_key",
              },
            }),
          };
        } else {
          answer = options.answer?.(call) ?? { status: 200, body: ok };
        }
        const headers = answer.headers ?? headerBlock;
        return Promise.resolve({
          status: answer.status,
          responseText: answer.body,
          responseURL: url,
          getAllResponseHeaders: () => headers,
        });
      },
      UnexpectedStatusException: Stub as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
      TimeoutException: Stub,
      BrowserOfflineException: Stub,
      SecurityException: Stub,
      CancelledException: Stub,
    };
  };
  return { factory, calls, created: () => created };
}

interface Captured {
  readonly stdout: string[];
  readonly stderr: string[];
}

async function runOpenAi(
  argv: readonly string[],
  mode: Mode,
  env: Readonly<Record<string, string | undefined>>,
  fake: FakeOpenAi,
): Promise<{ code: number; dir: string; out: Captured }> {
  const dir = await mkdtemp(join(tmpdir(), "rh-llm-record-"));
  const out: Captured = { stdout: [], stderr: [] };
  const cli = parseCliArgs(["--source", "openai", ...argv]);
  const source = cli.source;
  if (!isLlmRecordableProvider(source)) throw new Error("not an LLM source");
  const code = await runLlmRecorder({ ...cli, source }, mode, {
    env,
    stdout: (t) => out.stdout.push(t),
    stderr: (t) => out.stderr.push(t),
    fixtureDir: dir,
    transport: fake.factory,
    clock: createManualClock(Date.parse("2026-10-27T00:00:00Z")),
    toolVersion: "0.0.2",
  });
  return { code, dir, out };
}

const REPO = join(fixtureDirFor("pubmed"), "..", "..", "..");

describe("record-fixtures, LLM (P3-T30) — a key comes from the environment and from nothing else", () => {
  it("reads the provider's variable from the record it is given, and nothing when it is absent", () => {
    expect(llmKeyFromEnvironment("openai", {})).toBeUndefined();
    expect(
      llmKeyFromEnvironment("openai", { OPENAI_API_KEY: "  " }),
    ).toBeUndefined();
    expect(llmKeyFromEnvironment("gemini", { GEMINI_API_KEY: " v " })).toBe(
      "v",
    );
    expect(
      Object.values(LLM_KEY_ENV_VARS).every((n) => KEYISH_FIELD.test(n)),
    ).toBe(true);
  });

  it("refuses live mode when the key is only in a .env file in the working directory", async () => {
    const work = await mkdtemp(join(tmpdir(), "rh-llm-dotenv-"));
    const before = process.cwd();
    try {
      await writeFile(
        join(work, ".env"),
        `OPENAI_API_KEY=${syntheticSessionKey()}\n`,
      );
      process.chdir(work);
      const fake = fakeOpenAi();
      const { code, dir, out } = await runOpenAi(
        ["--live", "--confirm-spend-usd", "1"],
        "record",
        {},
        fake,
      );
      expect(code).toBe(2);
      expect(out.stderr.join("")).toMatch(/OPENAI_API_KEY is not set/u);
      expect(fake.created()).toBe(0);
      expect(await readdir(dir)).toEqual([]);
      await rm(dir, { recursive: true, force: true });
    } finally {
      process.chdir(before);
      await rm(work, { recursive: true, force: true });
    }
  });

  it("has no code path that reads a key file: no .env literal, no dotenv, no env-named read", async () => {
    const source = await readFile(
      join(REPO, "scripts", "record-fixtures.ts"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/u, ""))
      .join("\n");
    expect(code).not.toMatch(/["'`][^"'`\n]*\.env\b/u);
    expect(code).not.toMatch(/dotenv/u);
    const reads = code.match(/readFile(?:Sync)?\([^)]*\)/gu) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read, read).not.toMatch(/env/iu);
  });
});

describe("record-fixtures, LLM (P3-T30) — the gates, in order, before anything is sent", () => {
  const ENV = { OPENAI_API_KEY: syntheticSessionKey() };

  it("dry run: no transport, no key read, the stated spend printed", async () => {
    const fake = fakeOpenAi();
    const { code, dir, out } = await runOpenAi([], "dry-run", ENV, fake);
    try {
      expect(code).toBe(0);
      expect(fake.created()).toBe(0);
      const text = out.stdout.join("");
      expect(text).toMatch(/no key was read/u);
      expect(text).toMatch(/Stated spend \(an upper bound/u);
      expect(text).toMatch(/--live --confirm-spend-usd \d+\.\d{4}/u);
      expect(text).not.toContain(ENV.OPENAI_API_KEY);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("FIXTURE_MODE=record without --live: refused, nothing sent", async () => {
    const fake = fakeOpenAi();
    const { code, dir, out } = await runOpenAi(
      ["--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    await rm(dir, { recursive: true, force: true });
    expect(code).toBe(2);
    expect(out.stderr.join("")).toMatch(/needs --live/u);
    expect(fake.created()).toBe(0);
  });

  it("--live without --confirm-spend-usd: prints the stated spend and stops, nothing sent", async () => {
    const fake = fakeOpenAi();
    const { code, dir, out } = await runOpenAi(["--live"], "record", ENV, fake);
    await rm(dir, { recursive: true, force: true });
    expect(code).toBe(LLM_EXIT_SPEND_GATE);
    expect(out.stdout.join("")).toMatch(
      /Stopped at the spend gate: nothing was sent/u,
    );
    expect(out.stdout.join("")).not.toContain(ENV.OPENAI_API_KEY);
    expect(fake.created()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("--confirm-spend-usd below the stated spend: refused, nothing sent", async () => {
    const fake = fakeOpenAi();
    const { code, dir, out } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "0.0001"],
      "record",
      ENV,
      fake,
    );
    await rm(dir, { recursive: true, force: true });
    expect(code).toBe(2);
    expect(out.stderr.join("")).toMatch(/below the stated spend/u);
    expect(fake.calls).toEqual([]);
  });

  it("keeps the LLM flags to LLM providers and wants a positive amount", () => {
    expect(() => parseCliArgs(["--live"])).toThrow(UsageError);
    expect(() =>
      parseCliArgs(["--source", "openai", "--confirm-spend-usd", "-1"]),
    ).toThrow(UsageError);
    expect(() =>
      parseCliArgs(["--source", "openai", "--confirm-spend-usd", "x"]),
    ).toThrow(UsageError);
    expect(
      parseCliArgs(["--source=gemini", "--confirm-spend-usd=$0.05", "--live"]),
    ).toEqual({
      source: "gemini",
      dryRun: false,
      live: true,
      confirmSpendUsd: 0.05,
    });
  });

  it("stops before anything billed when the provider does not list the model", async () => {
    const fake = fakeOpenAi({ listed: ["gpt-5.6-terra"] });
    const { code, dir, out } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code).toBe(1);
      expect(out.stderr.join("")).toMatch(
        /does not list "gpt-5\.6-luna"[\s\S]*gpt-5\.6-terra/u,
      );
      expect(fake.calls.map((c) => c.method)).toEqual(["GET"]);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("record-fixtures, LLM (P3-T30) — what a recording writes", () => {
  const ENV = { OPENAI_API_KEY: syntheticSessionKey() };

  it("records every live scenario once, each with the right key, and writes only clean files", async () => {
    const fake = fakeOpenAi();
    const { code, dir, out } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code, out.stderr.join("")).toBe(0);
      expect(fake.calls).toHaveLength(7);
      const invalid = `Bearer ${invalidLlmKey("openai")}`;
      const valid = `Bearer ${ENV.OPENAI_API_KEY}`;
      expect(
        fake.calls.every(
          (c) => c.authorization === invalid || c.authorization === valid,
        ),
      ).toBe(true);
      expect(
        fake.calls.filter((c) => c.authorization === invalid),
      ).toHaveLength(1);
      const names = (await readdir(dir)).sort();
      expect(names.filter((n) => !n.endsWith("_meta.json"))).toEqual([
        "chat-json-malformed.json",
        "chat-json-ok.json",
        "chat-nonstream-ok.json",
        "chat-stream-ok.json",
        "error-401.json",
        "error-truncated.json",
        "models-list.json",
      ]);
      for (const name of names) {
        const text = await readFile(join(dir, name), "utf8");
        expect(text).not.toContain(ENV.OPENAI_API_KEY);
        expect(text).not.toContain(invalidLlmKey("openai"));
        expect(text).not.toMatch(
          /org-synthetic|proj_synthetic|__cf_bm|req_synthetic/u,
        );
        expect(redact(text)).toBe(text);
      }
      const stored = JSON.parse(
        await readFile(join(dir, "chat-nonstream-ok.json"), "utf8"),
      ) as { headers: Record<string, string> };
      expect(Object.keys(stored.headers).sort()).toEqual([
        "content-type",
        "x-ratelimit-remaining-requests",
      ]);
      const meta = JSON.parse(
        await readFile(join(dir, "chat-nonstream-ok_meta.json"), "utf8"),
      ) as { redactions: string[]; model: string; synthetic: boolean };
      expect(meta.model).toBe("gpt-5.6-luna");
      expect(meta.synthetic).toBe(false);
      expect(meta.redactions[0]).toMatch(
        /dropped 4 header\(s\).*openai-organization/u,
      );
      expect(out.stdout.join("") + out.stderr.join("")).not.toContain(
        ENV.OPENAI_API_KEY,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scrubs a key no KEY_PATTERNS shape matches, from a fixture and from what it prints", async () => {
    // Short and unprefixed: only the literal deny-list can catch it.
    const shortKey = ["plain", "key", "5x7q9"].join("-");
    const failing = fakeOpenAi({
      answer: (call) =>
        call.body?.includes("Reply with exactly one word") === true
          ? { status: 200, body: `{"echo":"${shortKey}"}` }
          : undefined,
    });
    const { code, dir, out } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1", "--only", "chat-nonstream-ok"],
      "record",
      { OPENAI_API_KEY: shortKey },
      failing,
    );
    try {
      expect(code).toBe(0);
      const text = await readFile(join(dir, "chat-nonstream-ok.json"), "utf8");
      expect(text).not.toContain(shortKey);
      expect(text).toContain("[redacted:env-secret]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // A transport failure whose message carries the key is printed scrubbed.
    const broken = fakeOpenAi();
    const factory = (): HttpTransport => {
      const base = broken.factory();
      return {
        ...base,
        request: () =>
          Promise.reject(new Error(`socket closed while sending ${shortKey}`)),
      };
    };
    const second = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      { OPENAI_API_KEY: shortKey },
      { ...broken, factory },
    );
    try {
      expect(second.code).toBe(1);
      const printed = second.out.stdout.join("") + second.out.stderr.join("");
      expect(printed).toMatch(/the model list failed/u);
      expect(printed).not.toContain(shortKey);
      expect(printed).toContain("[redacted:env-secret]");
      expect(out.stdout.join("") + out.stderr.join("")).not.toContain(shortKey);
    } finally {
      await rm(second.dir, { recursive: true, force: true });
    }
  });

  it("scrubs the session's key where an answer echoes it", async () => {
    const fake = fakeOpenAi({
      answer: (call) =>
        call.body?.includes("Reply with exactly one word") === true
          ? { status: 200, body: `{"echo":"${ENV.OPENAI_API_KEY}"}` }
          : undefined,
    });
    const { code, dir } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1", "--only", "chat-nonstream-ok"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code).toBe(0);
      const text = await readFile(join(dir, "chat-nonstream-ok.json"), "utf8");
      expect(text).not.toContain(ENV.OPENAI_API_KEY);
      // redact() takes the sk-proj- shape first; the literal deny-list is the
      // backstop for a key no KEY_PATTERNS shape matches.
      expect(text).toMatch(/\\"echo\\":\\"\[redacted:\d+\]\\"/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("aborts non-zero and writes nothing at all when a body still carries a key after redaction", async () => {
    const fake = fakeOpenAi({
      answer: (call) =>
        call.body?.includes("Count from one to twenty") === true
          ? {
              status: 200,
              body: '{"next":"https://x.test/?api_key=0123456789abcdef"}',
            }
          : undefined,
    });
    const { code, dir, out } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code).toBe(1);
      expect(out.stderr.join("")).toMatch(
        /Refusing to write fixture "chat-stream-ok"[\s\S]*Nothing was written/u,
      );
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops sending at the confirmed ceiling, settled on the tokens an answer reports", async () => {
    const fake = fakeOpenAi({
      answer: () => ({
        status: 200,
        body: JSON.stringify({
          id: "resp_big",
          object: "response",
          status: "completed",
          model: "gpt-5.6-luna",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "x" }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5_000_000,
            total_tokens: 5_000_010,
          },
        }),
      }),
    });
    const { code, dir, out } = await runOpenAi(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code).toBe(1);
      // The list, then the first billed call, which reported $6 of output.
      expect(fake.calls).toHaveLength(2);
      expect(out.stderr.join("")).toMatch(
        /chat-stream-ok: not sent — the confirmed ceiling/u,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("synthetic mode writes the four written scenarios with no transport and no key", async () => {
    const fake = fakeOpenAi();
    const { code, dir } = await runOpenAi([], "synthetic", {}, fake);
    try {
      expect(code).toBe(0);
      expect(fake.created()).toBe(0);
      expect(
        (await readdir(dir)).filter((n) => !n.endsWith("_meta.json")).sort(),
      ).toEqual([
        "error-429-no-retry-after.json",
        "error-429.json",
        "error-context-length.json",
        "refusal.json",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("record-fixtures, LLM (P3-T30) — the stated spend never under-states", () => {
  const NOW = Date.parse("2026-10-27T00:00:00Z");

  it("bounds every billed call at least as high as the product's own reservation would", () => {
    for (const provider of LLM_RECORDABLE_PROVIDERS) {
      const chosen = chooseLlmModel(provider, llmPriceSource(), NOW);
      const statement = stateLlmSpend(
        provider,
        chosen.model,
        chosen.prices,
        LLM_SCENARIOS,
        NOW,
      );
      for (const bound of statement.scenarios.filter((b) => b.billed)) {
        const request = llmScenarioRequest(bound.scenario, chosen.model);
        const product = requestEstimate(request, {
          pricesFor: () => chosen.prices,
          now: () => NOW,
          countTokens: (text) => estTokens(text),
        });
        const label = `${provider} ${bound.scenario}`;
        expect(bound.inputTokens, label).toBeGreaterThanOrEqual(
          product.inputTokens,
        );
        expect(bound.outputTokens, label).toBe(request.maxOutputTokens);
        expect(bound.costUsd, label).toBeGreaterThanOrEqual(
          product.costUsd ?? Infinity,
        );
        const chars = request.messages.reduce(
          (n, m) => n + m.content.length,
          0,
        );
        expect(bound.inputTokens, label).toBeGreaterThanOrEqual(
          Math.ceil(chars / 2),
        );
      }
      expect(statement.billedCalls).toBe(5);
      expect(statement.requests).toBe(7);
    }
  });

  it("chooses the cheapest priced model, and refuses an unpriced --model", () => {
    for (const provider of LLM_RECORDABLE_PROVIDERS) {
      const source = llmPriceSource();
      const billed = LLM_SCENARIOS.filter((s) => s.billed);
      const chosen = chooseLlmModel(provider, source, NOW);
      const best = stateLlmSpend(
        provider,
        chosen.model,
        chosen.prices,
        billed,
        NOW,
      ).costUsd;
      for (const id of modelsFor(source.current(), provider).map((m) => m.id)) {
        const prices = source.pricesFor(provider, id);
        if (prices === undefined) continue;
        expect(
          stateLlmSpend(provider, id, prices, billed, NOW).costUsd,
        ).toBeGreaterThanOrEqual(best);
      }
      expect(() =>
        chooseLlmModel(provider, source, NOW, "no-such-model"),
      ).toThrow(UsageError);
    }
  });

  it("states under $1 for all forty-four scenarios together, as card P3-T30 says, at the source's dated prices", () => {
    let total = 0;
    for (const provider of LLM_RECORDABLE_PROVIDERS) {
      const chosen = chooseLlmModel(provider, llmPriceSource(), NOW);
      const s = stateLlmSpend(
        provider,
        chosen.model,
        chosen.prices,
        LLM_SCENARIOS,
        NOW,
      );
      expect(s.pricesAsOf).toBe("2026-09-08");
      total += s.costUsd;
    }
    expect(LLM_SCENARIOS).toHaveLength(11);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(1);
  });

  it("prints a dollar figure rounded up, never below the bound", () => {
    for (const usd of [0.00001, 0.0073, 0.012345, 0.99999]) {
      expect(Number(usdUp(usd).slice(1))).toBeGreaterThanOrEqual(usd);
    }
  });
});

describe("record-fixtures, LLM (P3-T30) — no committed LLM file carries anything key-shaped", () => {
  it("every fixture, sidecar and request snapshot is free of KEY_PATTERNS, credential values and addresses", async () => {
    let read = 0;
    const dirs = [
      ...LLM_RECORDABLE_PROVIDERS.map((p) => llmFixtureDirFor(p)),
      join(REPO, "test", "contract", "llm", "__snapshots__"),
    ];
    for (const dir of dirs) {
      for (const name of await readdir(dir)) {
        if (!name.endsWith(".json") && !name.endsWith(".snap")) continue;
        const where = `${dir}/${name}`;
        const raw = await readFile(join(dir, name), "utf8");
        // A snapshot's JSON keys are header and field names, never values:
        // `anthropic-dangerous-direct-browser-access` (41 characters) would
        // trip redact()'s 40-character net. Credential values are withheld
        // and checked by the contract suite's `withheld`.
        const text = dir.endsWith("__snapshots__")
          ? raw.replace(/"[A-Za-z][A-Za-z0-9-]*"(?=\s*:)/gu, '""')
          : raw;
        expect(redact(text), where).toBe(text);
        expect(stripEmailAddresses(text).count, where).toBe(0);
        expect(text.includes(MAINTAINER_EMAIL), where).toBe(false);
        for (const provider of LLM_RECORDABLE_PROVIDERS) {
          expect(text.includes(invalidLlmKey(provider)), where).toBe(false);
        }
        if (!dir.endsWith("__snapshots__")) {
          expect(text, where).not.toMatch(
            /"(?:authorization|x-api-key|x-goog-api-key|cookie|set-cookie)"\s*:/iu,
          );
        }
        read += 1;
      }
    }
    // 4 providers × 4 synthetic fixtures × (fixture + sidecar) + 4 snapshots.
    expect(read).toBeGreaterThanOrEqual(4 * 8 + 4);
  });
});

// ---------------------------------------------------------------------------
// Gemini TTS (P6-T03): the recorder's gemini-tts source and its stand-ins
// ---------------------------------------------------------------------------

/** A Gemini-shaped key, synthetic, assembled at run time (never a literal). */
function syntheticGeminiKey(): string {
  return `${"AI"}za${"sessionkeyforatest".padEnd(35, "Q")}`;
}

interface FakeGeminiCall {
  readonly method: string;
  readonly url: string;
  readonly key: string | undefined;
  readonly body: string | undefined;
}

interface FakeGemini {
  readonly factory: () => HttpTransport;
  readonly calls: FakeGeminiCall[];
  readonly created: () => number;
}

/** The audio a fake answer carries: a real tone, so the base64 is long and opaque. */
const FAKE_AUDIO = Buffer.from(pcmTone(0.25, 523)).toString("base64");

/**
 * A fake `Zotero.HTTP` answering like Gemini's legacy surface: the model list
 * on GET (two TTS entries, one chat entry and a further page), audio for the
 * real key and a listed model, 404 for an unknown model, 400 for any other key.
 * Every answer carries a header echoing the key, which must never be stored;
 * `badKeyBody` overrides the 400's body.
 */
function fakeGemini(
  options: {
    readonly listed?: readonly string[];
    readonly badKeyBody?: (key: string) => string;
    readonly audioBody?: () => string;
  } = {},
): FakeGemini {
  const calls: FakeGeminiCall[] = [];
  let created = 0;
  class Stub extends Error {}
  const listed = options.listed ?? [
    "gemini-2.5-flash-preview-tts",
    "gemini-3.1-flash-tts-preview",
    "gemini-3.8-flash",
  ];
  const factory = (): HttpTransport => {
    created += 1;
    return {
      request(method, url, opts): Promise<HttpTransportXhr> {
        const headerEntries = Object.entries(opts.headers ?? {});
        const key = headerEntries.find(
          ([name]) => name.toLowerCase() === "x-goog-api-key",
        )?.[1];
        calls.push({ method, url, key, body: opts.body });
        const real = syntheticGeminiKey();
        let status = 200;
        let body: string;
        if (method === "GET") {
          body = JSON.stringify({
            models: listed.map((id) => ({
              name: `models/${id}`,
              displayName: id,
              supportedGenerationMethods: ["generateContent"],
            })),
            nextPageToken: "a-further-page",
          });
        } else if (key !== real) {
          status = 400;
          body =
            options.badKeyBody?.(key ?? "") ??
            JSON.stringify({
              error: {
                code: 400,
                message: `API key not valid. Echoed: ${key ?? ""}`,
                status: "INVALID_ARGUMENT",
              },
            });
        } else if (!listed.some((id) => url.includes(`/models/${id}:`))) {
          status = 404;
          body = JSON.stringify({
            error: { code: 404, message: "not found", status: "NOT_FOUND" },
          });
        } else {
          body =
            options.audioBody?.() ??
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "audio/L16;codec=pcm;rate=24000",
                          data: FAKE_AUDIO,
                        },
                      },
                    ],
                    role: "model",
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 11,
                candidatesTokenCount: 6,
                totalTokenCount: 17,
              },
            });
        }
        const headers =
          "content-type: application/json; charset=UTF-8\r\n" +
          `x-goog-api-key: ${key ?? ""}\r\nset-cookie: NID=synthetic\r\n` +
          "x-goog-request-id: synthetic";
        return Promise.resolve({
          status,
          responseText: body,
          responseURL: url,
          getAllResponseHeaders: () => headers,
        });
      },
      UnexpectedStatusException: Stub as unknown as HttpExceptionClass<
        Error & { readonly xmlhttp: HttpTransportXhr }
      >,
      TimeoutException: Stub,
      BrowserOfflineException: Stub,
      SecurityException: Stub,
      CancelledException: Stub,
    };
  };
  return { factory, calls, created: () => created };
}

async function runTts(
  argv: readonly string[],
  mode: Mode,
  env: Readonly<Record<string, string | undefined>>,
  fake: FakeGemini,
  dir?: string,
): Promise<{ code: number; dir: string; out: Captured }> {
  const target = dir ?? (await mkdtemp(join(tmpdir(), "rh-tts-record-")));
  const out: Captured = { stdout: [], stderr: [] };
  const cli = parseCliArgs(["--source", "gemini-tts", ...argv]);
  const source = cli.source;
  if (!isTtsRecordableSource(source)) throw new Error("not a TTS source");
  const code = await runTtsRecorder({ ...cli, source }, mode, {
    env,
    stdout: (t) => out.stdout.push(t),
    stderr: (t) => out.stderr.push(t),
    fixtureDir: target,
    transport: fake.factory,
    clock: createManualClock(Date.parse("2026-11-16T00:00:00Z")),
    toolVersion: "0.0.2",
  });
  return { code, dir: target, out };
}

/** Every file in `dir`, read as text. */
async function readAll(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of (await readdir(dir)).sort()) {
    files.set(name, await readFile(join(dir, name), "utf8"));
  }
  return files;
}

describe("record-fixtures, Gemini TTS (P6-T03) — the plan and the gates", () => {
  const ENV = { GEMINI_API_KEY: syntheticGeminiKey() };

  it("--dry-run lists the seven scenarios, the request count and an estimate, and exits 0 without a key", async () => {
    const fake = fakeGemini();
    const { code, dir, out } = await runTts(["--dry-run"], "dry-run", {}, fake);
    try {
      expect(code).toBe(0);
      expect(fake.created()).toBe(0);
      const text = out.stdout.join("");
      for (const s of TTS_SCENARIOS) expect(text).toContain(s.scenario);
      expect(TTS_SCENARIOS.map((s) => s.scenario)).toEqual([
        "models-list",
        "tts-en-short",
        "tts-ko-short",
        "error-unknown-model",
        "error-invalid-key",
        "error-429",
        "no-audio-part",
      ]);
      expect(text).toMatch(/no key was read/u);
      expect(text).toMatch(/5 live request\(s\), 2 billed/u);
      expect(text).toMatch(/Estimated spend[^\n]*at most \$0\.\d{4}/u);
      expect(text).toMatch(/--live --confirm-spend-usd \d+\.\d{4}/u);
      expect(text).toMatch(/audio-script-en/u);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prices only the two billed sentences, from docs/04 §4.2's table, and refuses an unpriced --model", () => {
    const statement = stateTtsSpend(
      "gemini-2.5-flash-preview-tts",
      TTS_SCENARIOS,
    );
    expect(statement.billedCalls).toBe(2);
    expect(statement.requests).toBe(5);
    expect(statement.outputTokens).toBe(
      2 * TTS_SECONDS_BOUND * TTS_AUDIO_TOKENS_PER_SECOND,
    );
    expect(statement.costUsd).toBeGreaterThan(0);
    expect(statement.costUsd).toBeLessThan(0.05);
    expect(chooseTtsModel()).toBe("gemini-2.5-flash-preview-tts");
    expect(TTS_DOCUMENTED_PRICES["gemini-3.1-flash-tts-preview"]).toEqual({
      inputPerMTokUsd: 1,
      outputPerMTokUsd: 20,
    });
    expect(() => stateTtsSpend("gemini-9-tts", TTS_SCENARIOS)).toThrow(
      UsageError,
    );
  });

  it("takes the LLM path's opt-ins for gemini-tts, and a literature source still refuses them", () => {
    expect(
      parseCliArgs([
        "--source",
        "gemini-tts",
        "--live",
        "--confirm-spend-usd",
        "0.25",
        "--model",
        "gemini-3.1-flash-tts-preview",
      ]),
    ).toEqual({
      source: "gemini-tts",
      dryRun: false,
      live: true,
      confirmSpendUsd: 0.25,
      model: "gemini-3.1-flash-tts-preview",
    });
    expect(() => parseCliArgs(["--source", "pubmed", "--live"])).toThrow(
      UsageError,
    );
    expect(() => selectTtsScenarios(["tts-fr-short"])).toThrow(UsageError);
  });

  it("FIXTURE_MODE=record without --live, or without the key: refused with exit 2, nothing sent", async () => {
    for (const [argv, env, message] of [
      [["--confirm-spend-usd", "1"], ENV, /needs --live/u],
      [
        ["--live", "--confirm-spend-usd", "1"],
        {},
        /GEMINI_API_KEY is not set/u,
      ],
    ] as const) {
      const fake = fakeGemini();
      const { code, dir, out } = await runTts(argv, "record", env, fake);
      await rm(dir, { recursive: true, force: true });
      expect(code).toBe(2);
      expect(out.stderr.join("")).toMatch(message);
      expect(fake.created()).toBe(0);
    }
  });

  it("--live without --confirm-spend-usd stops at the gate (exit 3); below the estimate is refused; nothing sent", async () => {
    const gate = fakeGemini();
    const stopped = await runTts(["--live"], "record", ENV, gate);
    await rm(stopped.dir, { recursive: true, force: true });
    expect(stopped.code).toBe(LLM_EXIT_SPEND_GATE);
    expect(stopped.out.stdout.join("")).not.toContain(ENV.GEMINI_API_KEY);
    expect(gate.calls).toEqual([]);
    const low = fakeGemini();
    const refused = await runTts(
      ["--live", "--confirm-spend-usd", "0.0001"],
      "record",
      ENV,
      low,
    );
    await rm(refused.dir, { recursive: true, force: true });
    expect(refused.code).toBe(2);
    expect(low.calls).toEqual([]);
  });

  it("stops before anything billed when Gemini does not list the model", async () => {
    const fake = fakeGemini({ listed: ["gemini-3.1-flash-tts-preview"] });
    const { code, dir, out } = await runTts(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code).toBe(1);
      expect(out.stderr.join("")).toMatch(
        /does not list "gemini-2\.5-flash-preview-tts"[\s\S]*gemini-3\.1-flash-tts-preview/u,
      );
      expect(fake.calls.map((c) => c.method)).toEqual(["GET"]);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("record-fixtures, Gemini TTS (P6-T03) — what a recording writes", () => {
  const ENV = { GEMINI_API_KEY: syntheticGeminiKey() };

  it("sends the key only in x-goog-api-key, the altered key once, and writes five clean fixtures", async () => {
    const fake = fakeGemini();
    const { code, dir, out } = await runTts(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code, out.stderr.join("")).toBe(0);
      const key = ENV.GEMINI_API_KEY;
      expect(fake.calls).toHaveLength(5);
      expect(fake.calls.every((c) => !c.url.includes(key))).toBe(true);
      expect(fake.calls.every((c) => !/[?&]key=/u.test(c.url))).toBe(true);
      expect(fake.calls.every((c) => !(c.body ?? "").includes(key))).toBe(true);
      expect(fake.calls.filter((c) => c.key === `${key}x`)).toHaveLength(1);
      expect(fake.calls.filter((c) => c.key === key)).toHaveLength(4);
      const posted = fake.calls.filter((c) => c.method === "POST");
      expect(posted.map((c) => new URL(c.url).pathname)).toEqual([
        "/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
        "/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
        `/v1beta/models/${TTS_UNKNOWN_MODEL}:generateContent`,
        "/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
      ]);
      expect(JSON.parse(posted[0]?.body ?? "{}")).toEqual(
        ttsRequestBody(TTS_TEXTS.en, TTS_VOICE),
      );
      const files = await readAll(dir);
      expect(
        [...files.keys()].filter((n) => !n.endsWith("_meta.json")),
      ).toEqual([
        "error-invalid-key.json",
        "error-unknown-model.json",
        "models-list.json",
        "tts-en-short.json",
        "tts-ko-short.json",
      ]);
      for (const [name, text] of files) {
        // P6-T03 step 5 and P6-T04's grep.
        expect(text, name).not.toMatch(/x-goog-api-key|key=|Bearer/iu);
        expect(text.includes(key), name).toBe(false);
        // Values never; a sidecar may name a dropped header, a fixture keeps none.
        expect(text, name).not.toMatch(/NID=synthetic/u);
        if (!name.endsWith("_meta.json")) {
          expect(text, name).not.toMatch(/x-goog-request-id|set-cookie/iu);
        }
      }
      const audio = JSON.parse(files.get("tts-en-short.json") ?? "{}") as {
        body: string;
      };
      expect(JSON.parse(audio.body)).toMatchObject({
        candidates: [
          { content: { parts: [{ inlineData: { data: FAKE_AUDIO } }] } },
        ],
      });
      const listing = JSON.parse(files.get("models-list.json") ?? "{}") as {
        body: string;
      };
      expect(
        (JSON.parse(listing.body) as { models: { name: string }[] }).models.map(
          (m) => m.name,
        ),
      ).toEqual([
        "models/gemini-2.5-flash-preview-tts",
        "models/gemini-3.1-flash-tts-preview",
      ]);
      const meta = JSON.parse(files.get("tts-ko-short_meta.json") ?? "{}") as {
        synthetic: boolean;
        model: string;
        voice: string;
        redactions: string[];
      };
      expect(meta).toMatchObject({
        synthetic: false,
        model: "gemini-2.5-flash-preview-tts",
        voice: "Charon",
      });
      expect(meta.redactions.join(" ")).toMatch(/preserved 1 base64 audio/u);
      expect(out.stdout.join("")).not.toContain(key);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses the whole run, writing nothing, when an answer still holds key= after redaction", async () => {
    const fake = fakeGemini({
      badKeyBody: (key) =>
        JSON.stringify({
          error: {
            message: `Retry at https://example.invalid/v1beta/models?key=${key}`,
          },
        }),
    });
    const { code, dir, out } = await runTts(
      ["--live", "--confirm-spend-usd", "1"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(code).toBe(1);
      expect(out.stderr.join("")).toMatch(
        /key= parameter[\s\S]*Nothing was written/u,
      );
      expect(out.stderr.join("")).not.toContain(ENV.GEMINI_API_KEY);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a body over 300 KB, writing nothing", async () => {
    const big = Buffer.from(pcmTone(5, 440)).toString("base64");
    const fake = fakeGemini({
      audioBody: () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/L16;codec=pcm;rate=24000",
                      data: big,
                    },
                  },
                ],
              },
            },
          ],
        }),
    });
    const { code, dir, out } = await runTts(
      ["--live", "--confirm-spend-usd", "1", "--only", "tts-en-short"],
      "record",
      ENV,
      fake,
    );
    try {
      expect(big.length).toBeGreaterThan(TTS_MAX_BODY_BYTES);
      expect(code).toBe(1);
      expect(out.stderr.join("")).toMatch(/over 300 KB/u);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("assertCleanTtsFixture refuses the key header's name, key= and the key's value, and lets the audio through", () => {
    const key = syntheticGeminiKey();
    const deny = [key];
    expect(() =>
      assertCleanTtsFixture("x", undefined, '{"h":"x-goog-api-key"}', deny),
    ).toThrow(/key header/u);
    expect(() =>
      assertCleanTtsFixture("x", undefined, '{"u":"?key=abc"}', deny),
    ).toThrow(/key= parameter/u);
    expect(() =>
      assertCleanTtsFixture("x", undefined, `{"v":"${key}"}`, deny),
    ).toThrow(/environment/u);
    const audio = `{"data":"${FAKE_AUDIO}"}`;
    expect(() => assertCleanTtsFixture("x", undefined, audio, deny)).toThrow(
      /credential pattern/u,
    );
    expect(() =>
      assertCleanTtsFixture(
        "x",
        undefined,
        audio,
        deny,
        ttsAudioTokens(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ inlineData: { data: FAKE_AUDIO } }] } },
            ],
          }),
        ),
      ),
    ).not.toThrow();
  });
});

describe("record-fixtures, Gemini TTS (P6-T03) — stand-ins", () => {
  it("synthetic mode writes a stand-in and a synthetic sidecar for every scenario, with no transport and no key", async () => {
    const fake = fakeGemini();
    const { code, dir } = await runTts([], "synthetic", {}, fake);
    try {
      expect(code).toBe(0);
      expect(fake.created()).toBe(0);
      const files = await readAll(dir);
      expect(files.size).toBe(2 * TTS_SCENARIOS.length);
      for (const s of TTS_SCENARIOS) {
        const meta = JSON.parse(
          files.get(`${s.scenario}_meta.json`) ?? "{}",
        ) as {
          synthetic: boolean;
          syntheticReason: string;
        };
        expect(meta.synthetic, s.scenario).toBe(true);
        expect(meta.syntheticReason.length, s.scenario).toBeGreaterThan(40);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never writes a stand-in over a recording", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-tts-keep-"));
    try {
      await writeFile(join(dir, "tts-en-short.json"), '{"recorded":true}\n');
      await writeFile(
        join(dir, "tts-en-short_meta.json"),
        '{"synthetic":false}\n',
      );
      const fake = fakeGemini();
      const { code, out } = await runTts([], "synthetic", {}, fake, dir);
      expect(code).toBe(0);
      expect(out.stdout.join("")).toMatch(
        /tts-en-short {2}kept: a recording is there/u,
      );
      expect(await readFile(join(dir, "tts-en-short.json"), "utf8")).toBe(
        '{"recorded":true}\n',
      );
      expect(await standInMayBeWritten(dir, "tts-en-short")).toBe(false);
      expect(await standInMayBeWritten(dir, "tts-ko-short")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("every committed TTS fixture has a sidecar saying synthetic, under 300 KB, with no key header, key= or Bearer", async () => {
    const dir = ttsFixtureDirFor("gemini-tts");
    const files = await readAll(dir);
    for (const s of TTS_SCENARIOS) {
      const fixture = files.get(`${s.scenario}.json`);
      const sidecar = files.get(`${s.scenario}_meta.json`);
      expect(fixture, s.scenario).toBeDefined();
      expect(sidecar, s.scenario).toBeDefined();
      // A stand-in is told from a recording by its sidecar (P6-T03 step 4).
      const meta = JSON.parse(sidecar ?? "{}") as {
        synthetic: boolean;
        syntheticReason?: string;
      };
      if (meta.synthetic) expect(meta.syntheticReason, s.scenario).toBeTruthy();
      const exchange = JSON.parse(fixture ?? "{}") as { body: string };
      expect(Buffer.byteLength(exchange.body), s.scenario).toBeLessThanOrEqual(
        TTS_MAX_BODY_BYTES,
      );
      const withoutAudio = ttsAudioTokens(exchange.body).reduce(
        (acc, token) => acc.split(token).join(""),
        fixture ?? "",
      );
      expect(redact(withoutAudio), s.scenario).toBe(withoutAudio);
    }
    for (const [name, text] of files) {
      expect(text, name).not.toMatch(/x-goog-api-key|key=|Bearer/iu);
    }
  });

  it("the audio stand-ins decode to 0.4 s of 24 kHz 16-bit PCM, ten audio tokens", async () => {
    const dir = ttsFixtureDirFor("gemini-tts");
    for (const scenario of ["tts-en-short", "tts-ko-short"]) {
      const exchange = JSON.parse(
        await readFile(join(dir, `${scenario}.json`), "utf8"),
      ) as { body: string };
      const body = JSON.parse(exchange.body) as {
        candidates: {
          content: {
            parts: { inlineData: { mimeType: string; data: string } }[];
          };
        }[];
        usageMetadata: { candidatesTokenCount: number };
      };
      const part = body.candidates[0]?.content.parts[0]?.inlineData;
      expect(part?.mimeType).toBe(TTS_PCM_MIME_TYPE);
      const pcm = Buffer.from(part?.data ?? "", "base64");
      expect(pcm.length).toBe(TTS_STAND_IN_SECONDS * 24_000 * 2);
      expect(body.usageMetadata.candidatesTokenCount).toBe(
        TTS_STAND_IN_SECONDS * TTS_AUDIO_TOKENS_PER_SECOND,
      );
    }
  });
});

describe("record-fixtures, LLM (P6-T03) — the two script scenarios", () => {
  it("are named with --only, never part of a provider's default list", () => {
    const names = (list: readonly { scenario: string }[]): string[] =>
      list.map((s) => s.scenario);
    expect(names(LLM_SCENARIOS)).not.toContain("audio-script-en");
    expect(names(selectLlmScenarios(undefined))).not.toContain(
      "audio-script-ko",
    );
    expect(
      names(selectLlmScenarios(["audio-script-en", "audio-script-ko"])),
    ).toEqual(["audio-script-en", "audio-script-ko"]);
    expect(LLM_AUDIO_SCRIPT_SCENARIOS.every((s) => s.billed)).toBe(true);
    expect(isAudioScriptScenario("chat-json-ok")).toBe(false);
  });

  it("are pending while the bundled prompt is absent, or there but refused by the parser", async () => {
    const promptDir = await mkdtemp(join(tmpdir(), "rh-audio-prompts-"));
    try {
      const absent = audioScriptPrompt("audio-script-en", promptDir);
      expect(absent.ready).toBe(false);
      if (!absent.ready) expect(absent.reason).toMatch(/has not landed/u);
      await writeFile(join(promptDir, "audio-script-en.v1.0.0.md"), "x");
      const broken = audioScriptPrompt("audio-script-en", promptDir);
      expect(broken.ready).toBe(false);
      if (!broken.ready) {
        expect(broken.reason).toMatch(/does not load yet/u);
        expect(broken.reason).toMatch(/missing the `---` front-matter block/u);
      }
      expect(audioScriptPrompt("chat-json-ok", promptDir).ready).toBe(false);
    } finally {
      await rm(promptDir, { recursive: true, force: true });
    }
  });

  // Changed 2026-11-17: the owner adopted the one-sentence rewordings
  // (plan/00 §6 item 382), the two files moved up into src/prompts/ and are
  // registered, so both scenarios are ready with the real parser.
  it("are ready now that the shipped prompt files load (owner, plan/00 §6 item 382)", () => {
    for (const s of LLM_AUDIO_SCRIPT_SCENARIOS) {
      const shipped = audioScriptPrompt(s.scenario);
      expect(shipped.ready, s.scenario).toBe(true);
      expect(() => audioScriptRequest(s.scenario, "a/model")).not.toThrow();
    }
    expect(() => audioScriptRequest("chat-json-ok", "a/model")).toThrow(
      UsageError,
    );
  });

  it("render the shipped prompt files into a request", () => {
    for (const [scenario, ceiling] of [
      ["audio-script-en", 2500],
      ["audio-script-ko", 3500],
    ] as const) {
      expect(audioScriptPrompt(scenario).ready).toBe(true);
      const request = audioScriptRequest(scenario, "a/model");
      expect(request.temperature).toBe(0.4);
      expect(request.maxOutputTokens).toBe(ceiling);
      expect(request.responseFormat).toBeUndefined();
      const [system, user] = request.messages;
      expect(system?.role).toBe("system");
      expect(system?.content).not.toMatch(/\{\{|\}\}/u);
      expect(user?.content).not.toMatch(/\{\{|\}\}/u);
      expect(user?.content).toContain("RHFIXT01");
      expect(user?.content).toContain('"Testa and colleagues, 2025"');
      expect(user?.content).toContain("<<<SOURCE_TEXT>>>");
      expect(user?.content).toMatch(
        scenario.endsWith("en") ? /about 1 minutes/u : /약 1분/u,
      );
      expect(user?.content).toMatch(/2022.*2025/u);
    }
  });

  it("have OpenRouter stand-ins whose scripts carry no marker docs/12 §13 rejects", async () => {
    const dir = llmFixtureDirFor(AUDIO_SCRIPT_STAND_IN_PROVIDER);
    for (const scenario of ["audio-script-en", "audio-script-ko"]) {
      const exchange = JSON.parse(
        await readFile(join(dir, `${scenario}.json`), "utf8"),
      ) as { body: string };
      const meta = JSON.parse(
        await readFile(join(dir, `${scenario}_meta.json`), "utf8"),
      ) as { synthetic: boolean; syntheticReason: string };
      expect(meta.synthetic).toBe(true);
      expect(meta.syntheticReason).toMatch(/Stand-in, not evidence/u);
      const content = (
        JSON.parse(exchange.body) as {
          choices: { message: { content: string } }[];
        }
      ).choices[0]?.message.content;
      expect(content).toBe(AUDIO_SCRIPT_STAND_IN_TEXT[scenario]);
      expect(content ?? "").not.toMatch(/\[\[|##|\||\*\*|`|http/u);
    }
    // One minute: 150 words ± 30 %, or 330 Hangul syllables ± 30 % (docs/12 §13–§14).
    const words = (AUDIO_SCRIPT_STAND_IN_TEXT["audio-script-en"] ?? "").split(
      /\s+/u,
    ).length;
    expect(words).toBeGreaterThanOrEqual(105);
    expect(words).toBeLessThanOrEqual(195);
    const syllables =
      (AUDIO_SCRIPT_STAND_IN_TEXT["audio-script-ko"] ?? "").match(/[가-힣]/gu)
        ?.length ?? 0;
    expect(syllables).toBeGreaterThanOrEqual(231);
    expect(syllables).toBeLessThanOrEqual(429);
  });

  it("writes their stand-ins in synthetic mode for OpenRouter, never over a recording", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-audio-standin-"));
    try {
      await writeFile(join(dir, "audio-script-ko.json"), '{"recorded":true}\n');
      await writeFile(
        join(dir, "audio-script-ko_meta.json"),
        '{"synthetic":false}\n',
      );
      const out: Captured = { stdout: [], stderr: [] };
      const cli = parseCliArgs([
        "--source",
        "openrouter",
        "--only",
        "audio-script-en,audio-script-ko",
      ]);
      const source = cli.source;
      if (!isLlmRecordableProvider(source))
        throw new Error("not an LLM source");
      const code = await runLlmRecorder({ ...cli, source }, "synthetic", {
        env: {},
        stdout: (t) => out.stdout.push(t),
        stderr: (t) => out.stderr.push(t),
        fixtureDir: dir,
        transport: () => {
          throw new Error("synthetic mode must not build a transport");
        },
        clock: createManualClock(Date.parse("2026-11-16T00:00:00Z")),
        toolVersion: "0.0.2",
      });
      expect(code, out.stderr.join("")).toBe(0);
      expect((await readdir(dir)).sort()).toEqual([
        "audio-script-en.json",
        "audio-script-en_meta.json",
        "audio-script-ko.json",
        "audio-script-ko_meta.json",
      ]);
      expect(await readFile(join(dir, "audio-script-ko.json"), "utf8")).toBe(
        '{"recorded":true}\n',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

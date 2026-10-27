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
  chooseLlmModel,
  fixtureDirFor,
  invalidLlmKey,
  isLlmRecordableProvider,
  literalDenyList,
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
  RECORDABLE_SOURCES,
  redactExchange,
  rescrubFixtures,
  runLlmRecorder,
  stateLlmSpend,
  stripEmailAddresses,
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

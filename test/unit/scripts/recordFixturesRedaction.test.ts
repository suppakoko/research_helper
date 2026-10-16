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
  fixtureDirFor,
  literalDenyList,
  MAINTAINER_ADDRESS_SPELLINGS,
  RECORDABLE_SOURCES,
  redactExchange,
  rescrubFixtures,
  stripEmailAddresses,
} from "../../../scripts/record-fixtures";
import { MAINTAINER_EMAIL } from "../../../src/core/http/userAgent";

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

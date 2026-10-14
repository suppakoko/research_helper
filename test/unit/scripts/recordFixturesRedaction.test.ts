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
 * Layer 1 (`docs/13` §2.1): plain Node, no network, no file written. The
 * deny-list is built from an explicit, empty environment so nothing here
 * depends on the shell the suite runs in.
 */

import { describe, expect, it } from "vitest";

import {
  assertClean,
  literalDenyList,
  MAINTAINER_ADDRESS_SPELLINGS,
  redactExchange,
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

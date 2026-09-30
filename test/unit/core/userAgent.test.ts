import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildUserAgent,
  contactParamsForHost,
  MAINTAINER_EMAIL,
  NCBI_EUTILS_HOST,
  ncbiIdentityParams,
  PROJECT_URL,
  TOOL_NAME,
} from "../../../src/core/http/userAgent";

/**
 * `P1-T05`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * Decision D10 (`docs/00` §3) and `docs/02` §2.2 are the authorities. Two of the
 * card's acceptance criteria are measured here: "the emitted `User-Agent`
 * matches `docs/02` §2.2's string with a real version, asserted by regex", and
 * the NCBI half of "no test can construct a request … carrying an `email` other
 * than the maintainer address" (the request-path half is in
 * `http-client.test.ts`).
 */

/**
 * `docs/02` §2.2's literal string, as a regex.
 *
 * `research_helper/<version> (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)`
 *
 * The version group is a semver core with an optional suffix, which is what
 * makes "with a **real** version" falsifiable: a placeholder such as
 * `{{version}}` or `__buildVersion__` cannot match it.
 */
const DOCS_02_USER_AGENT =
  /^research_helper\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?) \(https:\/\/github\.com\/suppakoko\/research_helper; mailto:suppakoko@gmail\.com\)$/;

/** The version the build would substitute. */
function packageVersion(): string {
  // `fileURLToPath(import.meta.url)` and `resolve`, not `new URL(…, import.meta.url)`:
  // under `tsconfig.json`'s sandbox lib the global `URL` is not Node's, and
  // `readFileSync` rejects it.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg: unknown = JSON.parse(
    readFileSync(resolve(here, "../../../package.json"), "utf8"),
  );
  const version = (pkg as { version?: unknown }).version;
  if (typeof version !== "string")
    throw new Error("package.json has no version");
  return version;
}

describe("buildUserAgent", () => {
  it("emits docs/02 §2.2's string with the shipped version", () => {
    const ua = buildUserAgent(packageVersion());

    expect(ua).toMatch(DOCS_02_USER_AGENT);
    expect(DOCS_02_USER_AGENT.exec(ua)?.[1]).toBe(packageVersion());
  });

  it("carries the maintainer address, the project URL and the tool name", () => {
    const ua = buildUserAgent("1.2.3");

    expect(ua).toContain(`mailto:${MAINTAINER_EMAIL}`);
    expect(ua).toContain(PROJECT_URL);
    expect(ua.startsWith(`${TOOL_NAME}/`)).toBe(true);
  });

  it("accepts a pre-release or build suffix", () => {
    expect(buildUserAgent("0.1.0-beta.2")).toMatch(DOCS_02_USER_AGENT);
    expect(buildUserAgent("0.1.0+build.7")).toMatch(DOCS_02_USER_AGENT);
  });

  // docs/02 §2.2: "The build substitutes it at package time and must fail rather
  // than ship an unsubstituted placeholder." The build cannot fail on a string
  // it never inspects, so the inspection is here.
  it.each([
    "{{version}}",
    "__buildVersion__",
    "",
    " ",
    "0.0",
    "v1.2.3",
    "1.2.3 ",
  ])("refuses the unsubstituted or malformed version %j", (version) => {
    expect(() => buildUserAgent(version)).toThrow(RangeError);
  });
});

describe("NCBI contact parameters (D10)", () => {
  it("always carries the maintainer address, never a user's", () => {
    expect(ncbiIdentityParams()).toStrictEqual({
      tool: TOOL_NAME,
      email: MAINTAINER_EMAIL,
    });
  });

  it("is what contactParamsForHost returns for the E-utilities host", () => {
    expect(contactParamsForHost(NCBI_EUTILS_HOST)).toStrictEqual(
      ncbiIdentityParams(),
    );
    expect(contactParamsForHost(NCBI_EUTILS_HOST.toUpperCase())).toStrictEqual(
      ncbiIdentityParams(),
    );
  });

  // docs/02 §2.2's final assignment table gives Europe PMC an `email=` and
  // Crossref a `mailto=`; both are Phase 2 adapters, and Crossref's needs the
  // `contactEmail` pref that `core/` may not read (docs/07 §2.3).
  it("returns nothing for a host Phase 1 has no assignment for", () => {
    expect(contactParamsForHost("api.crossref.org")).toStrictEqual({});
    expect(contactParamsForHost("www.ebi.ac.uk")).toStrictEqual({});
  });

  it("names the host docs/07 §7.3 keys the rate limiter on", () => {
    expect(NCBI_EUTILS_HOST).toBe("eutils.ncbi.nlm.nih.gov");
  });
});

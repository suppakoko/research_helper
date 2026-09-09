/**
 * P0-T22 step 2–3 — measure unauthenticated Semantic Scholar throttling.
 *
 * `docs/11` §4.3 `V-14` asks what unkeyed Semantic Scholar access actually
 * does, and `docs/02` §6.4 records the answer as of 2026-09-08: HTTP 429 on
 * the first attempt, again after an 8-second wait, and again after a further
 * 20 seconds, with an `x-amzn-ErrorType: TooManyRequestsException` header and
 * a small JSON body. This script re-runs that measurement so the spike report
 * can say whether the shared anonymous pool still behaves that way, and so
 * that Phase 2's typed error mapping is written from a body we actually
 * observed rather than from a paraphrase.
 *
 * **This script deliberately makes very few requests.** The card's `Do NOT`
 * list is explicit: the anonymous pool is shared with every other unkeyed
 * client on the internet, so hammering it to "get better data" harms them and
 * proves nothing `docs/02` §6.4 has not already established. The schedule
 * below issues 12 requests over roughly 70 seconds, shaped like §6.4's own
 * evidence (an attempt, then +8 s, then +20 s, then a longer +30 s tail), and
 * spaces requests inside each burst at 1.2 s to stay under the 0.9 req/s
 * budget `docs/02` §2.4 and `docs/07` §7.3 set for this host. Do not raise
 * either number.
 *
 * The application for a key is **not** this script's job and must not be
 * automated: it is a web form carrying the maintainer's identity and contact
 * details (card `P0-T22`, `Human gate`).
 *
 * Run it with (from the repository root):
 *
 * ```sh
 * node --experimental-strip-types scripts/spike-s2-throttle.ts
 * ```
 *
 * The card's `Verify with` says `npx tsx scripts/spike-s2-throttle.ts`, but
 * `tsx` is not a dependency of this repository — `package.json` names it only
 * in the unrelated `fixtures:record` script — and `P0-T22` may not install
 * one. Node 22's type stripping runs the file as-is.
 *
 * Exit code: 0 whenever the endpoint answered at all, whatever it answered
 * with — a 429 is the measurement, not a failure. Non-zero only if every
 * request failed at the transport layer (offline, DNS, TLS), because then
 * nothing was measured and the output must not be read as evidence.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** `docs/02` §6.1 — the Academic Graph base URL. */
const BASE_URL = "https://api.semanticscholar.org/graph/v1/paper/search";

/**
 * A deliberately trivial query: `docs/02` §6.5 notes `/paper/search` takes
 * plain text only, and `limit=1` keeps the response as small as the endpoint
 * allows. We are measuring the gate, not the corpus.
 */
const QUERY: Readonly<Record<string, string>> = {
  query: "machine learning",
  limit: "1",
  fields: "title",
};

/**
 * Milliseconds to wait *before* each request. Twelve entries, four bursts of
 * three, mirroring the shape of `docs/02` §6.4's 2026-09-08 evidence.
 * See the file header before changing this.
 */
const SCHEDULE: readonly number[] = [
  0, 1_200, 1_200, 8_000, 1_200, 1_200, 20_000, 1_200, 1_200, 30_000, 1_200,
  1_200,
];

/** Per-request timeout. Generous: a slow answer is still an answer. */
const TIMEOUT_MS = 20_000;

/** Response bodies are tiny; this only guards against a surprise. */
const MAX_BODY_CHARS = 4_000;

// ---------------------------------------------------------------------------
// User-Agent
// ---------------------------------------------------------------------------

/**
 * The exact `User-Agent` form `docs/02` §2.2 specifies, with the maintainer
 * address decision **D10** (`docs/00` §3) fixed at build time. It is not a
 * user setting and must never carry a user's address.
 */
function buildUserAgent(version: string): string {
  return (
    `research_helper/${version} ` +
    `(https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)`
  );
}

/** Reads `version` out of the repository's `package.json`. */
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "..", "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }
  throw new Error("package.json has no string `version` field");
}

// ---------------------------------------------------------------------------
// One probe
// ---------------------------------------------------------------------------

interface Probe {
  /** 1-based request number. */
  readonly seq: number;
  /** Milliseconds slept immediately before this request. */
  readonly waitedMsBefore: number;
  /** Milliseconds from the start of the run to the response. */
  readonly atMs: number;
  /** Round-trip time of this request. */
  readonly durationMs: number;
  /** HTTP status, or `null` when the request never produced a response. */
  readonly status: number | null;
  readonly statusText: string;
  /** Every response header, lower-cased, in the order fetch reports them. */
  readonly headers: ReadonlyArray<readonly [string, string]>;
  /** The response body verbatim, truncated only at {@link MAX_BODY_CHARS}. */
  readonly body: string;
  /** Byte length of the untruncated body. */
  readonly bodyBytes: number;
  /** Transport-level failure (offline, DNS, TLS, timeout), else `null`. */
  readonly transportError: string | null;
}

async function probe(
  seq: number,
  waitedMsBefore: number,
  startedAt: number,
  userAgent: string,
): Promise<Probe> {
  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(QUERY)) {
    url.searchParams.set(key, value);
  }

  const t0 = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const full = await response.text();
    return {
      seq,
      waitedMsBefore,
      atMs: Date.now() - startedAt,
      durationMs: Date.now() - t0,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()].map(
        ([name, value]) => [name, value] as const,
      ),
      body: full.slice(0, MAX_BODY_CHARS),
      bodyBytes: Buffer.byteLength(full, "utf8"),
      transportError: null,
    };
  } catch (error) {
    return {
      seq,
      waitedMsBefore,
      atMs: Date.now() - startedAt,
      durationMs: Date.now() - t0,
      status: null,
      statusText: "",
      headers: [],
      body: "",
      bodyBytes: 0,
      transportError:
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
    };
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(line: string): void {
  process.stdout.write(`${line}\n`);
}

function reportProbe(p: Probe): void {
  report("");
  report(
    `--- request ${String(p.seq)}/${String(SCHEDULE.length)} ` +
      `(waited ${String(p.waitedMsBefore)} ms; t+${String(p.atMs)} ms; ` +
      `rtt ${String(p.durationMs)} ms) ---`,
  );
  if (p.transportError !== null) {
    report(`TRANSPORT ERROR: ${p.transportError}`);
    report("  (no HTTP response — this is NOT a throttling observation)");
    return;
  }
  report(`HTTP ${String(p.status)} ${p.statusText}`);
  for (const [name, value] of p.headers) {
    report(`  ${name}: ${value}`);
  }
  report(`  body (${String(p.bodyBytes)} bytes, verbatim as a JS string):`);
  report(`  ${JSON.stringify(p.body)}`);
}

function summarise(probes: readonly Probe[]): void {
  report("");
  report("===========================================================");
  report("SUMMARY");
  report("===========================================================");

  const counts = new Map<string, number>();
  for (const p of probes) {
    const key =
      p.transportError !== null
        ? `transport error (${p.transportError})`
        : `HTTP ${String(p.status)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  report("Status distribution:");
  for (const [key, n] of counts) {
    report(`  ${key}: ${String(n)}`);
  }

  report("");
  report("Timeline (seq, t+ms, waited-before-ms, outcome):");
  for (const p of probes) {
    const outcome =
      p.transportError !== null
        ? `transport error: ${p.transportError}`
        : `HTTP ${String(p.status)}`;
    report(
      `  ${String(p.seq).padStart(2)}  t+${String(p.atMs).padStart(6)}  ` +
        `waited ${String(p.waitedMsBefore).padStart(6)}  ${outcome}`,
    );
  }

  report("");
  report("Distinct non-2xx bodies observed (verbatim):");
  const seen = new Set<string>();
  let anyBody = false;
  for (const p of probes) {
    if (p.status === null || (p.status >= 200 && p.status < 300)) continue;
    if (seen.has(p.body)) continue;
    seen.add(p.body);
    anyBody = true;
    report(
      `  status ${String(p.status)}, ${String(p.bodyBytes)} bytes: ` +
        JSON.stringify(p.body),
    );
  }
  if (!anyBody) report("  (none)");

  // The three checks `docs/02` §6.4's 2026-09-08 evidence makes. Reported
  // mechanically; the verdict sentence belongs in the spike report.
  const first = probes[0];
  const afterEight = probes[3];
  const afterTwenty = probes[6];
  report("");
  report("Comparison with docs/02 §6.4 (2026-09-08 evidence):");
  report(
    `  §6.4: 429 on the first attempt          -> observed: ` +
      describeStatus(first),
  );
  report(
    `  §6.4: 429 again after an 8 s wait       -> observed: ` +
      describeStatus(afterEight),
  );
  report(
    `  §6.4: 429 again after a further 20 s    -> observed: ` +
      describeStatus(afterTwenty),
  );
  const any429 = probes.some((p) => p.status === 429);
  report(`  any HTTP 429 anywhere in the run        -> ${String(any429)}`);
}

function describeStatus(p: Probe | undefined): string {
  if (p === undefined) return "not run";
  if (p.transportError !== null) return `transport error: ${p.transportError}`;
  return `HTTP ${String(p.status)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const userAgent = buildUserAgent(readPackageVersion());
const startedAt = Date.now();

report("P0-T22 / V-14 — unauthenticated Semantic Scholar throttling probe");
report(`Started:    ${new Date(startedAt).toISOString()}`);
report(`Endpoint:   ${BASE_URL}`);
report(`Query:      ${JSON.stringify(QUERY)}`);
report(`User-Agent: ${userAgent}`);
report(`Requests:   ${String(SCHEDULE.length)} (no x-api-key header is sent)`);

const probes: Probe[] = [];
for (const [index, waitMs] of SCHEDULE.entries()) {
  if (waitMs > 0) await sleep(waitMs);
  const p = await probe(index + 1, waitMs, startedAt, userAgent);
  probes.push(p);
  reportProbe(p);
}

summarise(probes);

const measuredAnything = probes.some((p) => p.status !== null);
if (!measuredAnything) {
  report("");
  report(
    "FAILED: every request failed at the transport layer. Nothing was " +
      "measured; do not record this run as evidence about throttling.",
  );
  process.exitCode = 1;
}

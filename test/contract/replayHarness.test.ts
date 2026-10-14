/**
 * The replay harness's own contract, in Node — `P2-T25`.
 *
 * Three claims, each of which the five Phase 2 adapter cards inherit without
 * re-proving:
 *
 * 1. **`fixtureKey` is byte-identical to what `P1-T11` recorded under.** The
 *    digest moved from `node:crypto` to `test/support/sha256.ts`, so the key is
 *    pinned to file names **already on disk** — never to a recomputation — for
 *    every scenario the recorder plans. The card's criterion 2.
 * 2. **The pure SHA-256 agrees with `node:crypto`**, on the committed keys'
 *    inputs and on generated inputs that cross every padding boundary and carry
 *    non-ASCII text. `createHash` is the reference the fixtures were made with.
 * 3. **The Node face and the core answer alike**: `test/contract/_transport.ts`
 *    binds `test/support/fixtureIoNode.ts` and nothing else.
 *
 * Everything here is `[ours]` in `pubmed.contract.test.ts`'s vocabulary: no
 * service can make these fail.
 */

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { independentPlan, plannedRequest } from "../../scripts/record-fixtures";
import { nodeFixtureIo } from "../support/fixtureIoNode";
import {
  assertFixturesFresh as assertFixturesFreshWith,
  createReplayHttpClient as createReplayHttpClientWith,
  listFixtureMeta as listFixtureMetaWith,
} from "../support/fixtureReplay";
import {
  PUBMED_PAGE_SIZE,
  PUBMED_SYNTHETIC_429_QUERY,
  PUBMED_SYNTHETIC_500_QUERY,
  PUBMED_TYPICAL_QUERY,
  recordedEsearchRequest,
} from "../support/pubmedRecordedRequests";
import { sha256Hex } from "../support/sha256";
import {
  assertFixturesFresh,
  createReplayHttpClient,
  fixtureFileFor,
  fixtureKey,
  listFixtureMeta,
  META_SUFFIX,
} from "./_transport";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/pubmed",
);

/**
 * The one fixture name this file pins by hand: `paginated-page-1`, an `esearch`
 * for `QUERY_TYPICAL` with `retmax=3`, recorded 2026-10-07. Written out rather
 * than derived so that a change to `fixtureKey`'s input shape, to the redaction
 * pattern or to the digest fails against a constant, not against itself.
 */
const PAGINATED_PAGE_1_KEY = "b68358327ce730cd";

/** The request `fixtureKey` hashes, spelled the way the recorder spells it. */
function requestOf(scenario: string) {
  const planned = plannedRequest(scenario);
  return {
    method: planned.method,
    url: planned.url,
    ...(planned.body !== undefined && { body: planned.body }),
  };
}

/** `docs/13` §2.2's hash input, so the reference digest hashes the same bytes. */
function keyInput(req: { method: string; url: string; body?: string }) {
  const redacted = req.url.replace(
    /(api[_-]?key|key|token)=[^&]+/gi,
    "$1=REDACTED",
  );
  return `${req.method} ${redacted} ${req.body ?? ""}`;
}

function nodeSha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A small deterministic generator, so a failing input can be reproduced. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** Code points that encode to one, two, three and four UTF-8 bytes. */
const ALPHABET = [
  ..."abcXYZ019 =&?/:-_.",
  "é",
  "ß",
  "β",
  "한",
  "글",
  "—",
  "…",
  " ",
  "😀",
  "🧬",
];

describe("fixtureKey names the committed fixtures", () => {
  it("reproduces the on-disk name of paginated-page-1, byte for byte", () => {
    expect(fixtureKey(requestOf("paginated-page-1"))).toBe(
      PAGINATED_PAGE_1_KEY,
    );
    expect(fixtureFileFor(FIXTURE_DIR, requestOf("paginated-page-1"))).toBe(
      `${FIXTURE_DIR}/${PAGINATED_PAGE_1_KEY}.json`,
    );
  });

  it("names a file that exists for every scenario the recorder plans", async () => {
    const onDisk = new Set(
      (await readdir(FIXTURE_DIR))
        .filter((n) => n.endsWith(".json") && !n.endsWith(META_SUFFIX))
        .map((n) => n.slice(0, -".json".length)),
    );
    expect(onDisk.size).toBe(17);

    // Every planned request — the eleven independent ones plus the synthetic
    // set — must resolve to a committed file. The two `paginated-*-efetch`
    // fixtures are keyed under ids read out of the recorded pages, so they are
    // reached through the adapter in `pubmed.contract.test.ts` instead.
    const planned = [
      ...independentPlan().map((p) => p.scenario),
      "error-429",
      "error-500",
      "error-malformed",
      "search-error-upstream",
    ];
    expect(planned).toHaveLength(15);
    for (const scenario of planned) {
      const key = fixtureKey(requestOf(scenario));
      expect(
        key,
        `${scenario} hashes to ${key}, which is not on disk`,
      ).toSatisfy((k: string) => onDisk.has(k));
    }
  });

  it("changes the key when the request changes by one byte, so a drifted request misses", async () => {
    const onDisk = new Set(
      (await readdir(FIXTURE_DIR)).map((n) => n.slice(0, -".json".length)),
    );
    const base = requestOf("paginated-page-1");
    const drifted = { ...base, url: `${base.url}&` };
    expect(fixtureKey(drifted)).not.toBe(PAGINATED_PAGE_1_KEY);
    expect(onDisk.has(fixtureKey(drifted))).toBe(false);
    // The body is part of the input too: an empty body and no body hash alike,
    // because §2.2 writes `body ?? ""`, and anything else does not.
    expect(fixtureKey({ ...base, body: "" })).toBe(PAGINATED_PAGE_1_KEY);
    expect(fixtureKey({ ...base, body: " " })).not.toBe(PAGINATED_PAGE_1_KEY);
  });

  it("hits an on-disk fixture for every request test/support/pubmedRecordedRequests.ts builds", async () => {
    // The sandbox-side copy of the recorder's queries. If either side drifts,
    // this is where it shows, in Node, before any Zotero run.
    const onDisk = new Set(
      (await readdir(FIXTURE_DIR)).map((n) => n.slice(0, -".json".length)),
    );
    const requests = {
      "paginated-page-1": recordedEsearchRequest(
        PUBMED_TYPICAL_QUERY,
        PUBMED_PAGE_SIZE,
        0,
      ),
      "paginated-page-2": recordedEsearchRequest(
        PUBMED_TYPICAL_QUERY,
        PUBMED_PAGE_SIZE,
        PUBMED_PAGE_SIZE,
      ),
      "search-typical": recordedEsearchRequest(PUBMED_TYPICAL_QUERY, 20, 0),
      "error-429": recordedEsearchRequest(PUBMED_SYNTHETIC_429_QUERY, 20, 0),
      "error-500": recordedEsearchRequest(PUBMED_SYNTHETIC_500_QUERY, 20, 0),
    };
    for (const [scenario, request] of Object.entries(requests)) {
      expect(request.url, scenario).toBe(plannedRequest(scenario).url);
      expect(onDisk.has(fixtureKey(request)), scenario).toBe(true);
    }
    expect(fixtureKey(requests["paginated-page-1"])).toBe(PAGINATED_PAGE_1_KEY);
  });

  it("redacts a credential's value and nothing else before hashing", () => {
    const base = requestOf("search-typical");
    const keyed = { ...base, url: `${base.url}&api_key=0123456789abcdef` };
    // Value-only: the parameter stays, so a keyed recording and an unkeyed
    // replay hash differently (fixtureReplay.ts, property 1).
    expect(fixtureKey(keyed)).not.toBe(fixtureKey(base));
    expect(fixtureKey(keyed)).toBe(
      fixtureKey({ ...base, url: `${base.url}&api_key=anything-else` }),
    );
  });
});

describe("the pure SHA-256 agrees with node:crypto", () => {
  it("on the hash input of every committed fixture", () => {
    for (const planned of independentPlan()) {
      const input = keyInput(requestOf(planned.scenario));
      expect(sha256Hex(input), planned.scenario).toBe(nodeSha256Hex(input));
    }
  });

  it("on the published test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // FIPS 180-4 example 2: two blocks.
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("on every length that crosses a padding boundary", () => {
    for (let length = 0; length <= 130; length += 1) {
      const input = "a".repeat(length);
      expect(sha256Hex(input), `length ${String(length)}`).toBe(
        nodeSha256Hex(input),
      );
    }
  });

  it("on 300 generated inputs with multi-byte UTF-8", () => {
    const next = mulberry32(0x5eed);
    for (let i = 0; i < 300; i += 1) {
      const length = Math.floor(next() * 200);
      let input = "";
      for (let j = 0; j < length; j += 1) {
        input += ALPHABET[Math.floor(next() * ALPHABET.length)] ?? "";
      }
      expect(sha256Hex(input), JSON.stringify(input)).toBe(
        nodeSha256Hex(input),
      );
    }
  });
});

describe("the Node face binds the core to the Node file system", () => {
  it("lists and ages the same sidecars either way", async () => {
    const viaFace = await listFixtureMeta(FIXTURE_DIR);
    const viaCore = await listFixtureMetaWith(FIXTURE_DIR, nodeFixtureIo);
    expect(viaFace).toEqual(viaCore);
    expect(viaFace).toHaveLength(17);

    const now = Date.UTC(2026, 9, 13);
    const faceReport = await assertFixturesFresh(FIXTURE_DIR, now);
    const coreReport = await assertFixturesFreshWith(
      FIXTURE_DIR,
      now,
      nodeFixtureIo,
    );
    expect(faceReport).toEqual(coreReport);
    expect(faceReport.checked).toBe(17);
  });

  it("replays the same bytes either way, and reports a missing fixture by its command", async () => {
    const planned = plannedRequest("paginated-page-1");
    const face = createReplayHttpClient({ dir: FIXTURE_DIR, host: "x" });
    const core = createReplayHttpClientWith({
      dir: FIXTURE_DIR,
      host: "x",
      io: nodeFixtureIo,
    });
    const [a, b] = await Promise.all([
      face.client.request("GET", planned.url, { responseType: "text" }),
      core.client.request("GET", planned.url, { responseType: "text" }),
    ]);
    expect(a.body).toBe(b.body);
    expect(a.body).toContain('"idlist":["39086673","36997768","36997683"]');
    expect(face.transport.calls[0]?.fixture).toBe(
      `${FIXTURE_DIR}/${PAGINATED_PAGE_1_KEY}.json`,
    );

    await expect(
      face.client.request("GET", `${planned.url}&`, { responseType: "text" }),
    ).rejects.toThrow(
      /^Missing fixture .*\nRecord it with: FIXTURE_MODE=record npm run fixtures:record$/u,
    );
  });

  it("reads directory names, not paths", async () => {
    const names = await nodeFixtureIo.listNames(FIXTURE_DIR);
    // 17 fixtures and 17 sidecars; the directory's `.gitkeep` is not counted.
    expect(names.filter((n) => n.endsWith(".json"))).toHaveLength(34);
    for (const name of names) {
      expect(name).not.toMatch(/[/\\]/u);
    }
  });
});

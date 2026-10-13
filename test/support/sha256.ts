/**
 * SHA-256 over a string, in plain TypeScript, for the fixture key.
 *
 * **Why this exists (`P2-T25`).** `docs/13` §2.2 names a fixture after
 * `sha256(method, redacted URL, body)` truncated to 16 hex characters, and the
 * harness that computes it must run in two places with two different digest
 * facilities:
 *
 * - **Node** has `node:crypto`'s `createHash`, which is synchronous.
 * - **The Zotero sandbox and the scaffold's test-runner window** have
 *   `crypto.subtle.digest`, which is **asynchronous** (it returns a Promise)
 *   and has no synchronous sibling — measured 2026-10-13 on Zotero 10.0.3,
 *   Gecko 140.15.0, Windows, by `test/integration/searchDialog-flow.spec.ts`'s
 *   `P2-T25` block, and recorded in `docs/01` §2.3.
 *
 * Making `fixtureKey` asynchronous to use `crypto.subtle` would ripple into
 * every caller — `scripts/record-fixtures.ts` calls it three times, once inside
 * a synchronous template string, and `test/contract/pubmed.contract.test.ts`
 * calls `fixtureFileFor` synchronously — none of which `P2-T25` may edit. A
 * digest written here, with no platform import, keeps the function synchronous
 * on both platforms and keeps its output **byte-identical** to `createHash`'s:
 * `test/contract/replayHarness.test.ts` asserts that against `node:crypto` for
 * every committed fixture name and for a few hundred generated inputs, and the
 * `P2-T25` block asserts it against `crypto.subtle.digest` inside Zotero.
 *
 * FIPS 180-4, one message at a time, no streaming. The inputs are request
 * descriptions a few hundred bytes long, so there is nothing to optimise.
 * `TextEncoder` is the one global used, and it is present in Node, in the
 * sandbox (`docs/01` §2.3's measured list) and in a chrome window.
 */

/** The 64 round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The initial hash value: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL_STATE: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

/** Read `index` of a word array under `noUncheckedIndexedAccess`, failing loudly rather than hashing `undefined`. */
function word(words: ArrayLike<number>, index: number): number {
  const value = words[index];
  if (value === undefined) {
    throw new RangeError(`sha256: word ${String(index)} is out of range`);
  }
  return value;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * SHA-256 of `bytes`, as 32 bytes.
 *
 * @param bytes - the message
 * @returns the digest, big-endian, 32 bytes long
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  // Padding: one 0x80 byte, zeros to 56 mod 64, then the bit length as a
  // 64-bit big-endian integer. JavaScript numbers hold the length exactly up
  // to 2^53 bits, far beyond any fixture request.
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const block = new Uint8Array(paddedLength);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = Uint32Array.from(INITIAL_STATE);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      schedule[t] = view.getUint32(offset + t * 4);
    }
    for (let t = 16; t < 64; t += 1) {
      const w15 = word(schedule, t - 15);
      const w2 = word(schedule, t - 2);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      schedule[t] =
        (word(schedule, t - 16) + s0 + word(schedule, t - 7) + s1) >>> 0;
    }

    let a = word(state, 0);
    let b = word(state, 1);
    let c = word(state, 2);
    let d = word(state, 3);
    let e = word(state, 4);
    let f = word(state, 5);
    let g = word(state, 6);
    let h = word(state, 7);

    for (let t = 0; t < 64; t += 1) {
      const bigSigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 =
        (h + bigSigma1 + choose + word(K, t) + word(schedule, t)) >>> 0;
      const bigSigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (word(state, 0) + a) >>> 0;
    state[1] = (word(state, 1) + b) >>> 0;
    state[2] = (word(state, 2) + c) >>> 0;
    state[3] = (word(state, 3) + d) >>> 0;
    state[4] = (word(state, 4) + e) >>> 0;
    state[5] = (word(state, 5) + f) >>> 0;
    state[6] = (word(state, 6) + g) >>> 0;
    state[7] = (word(state, 7) + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) {
    outView.setUint32(i * 4, word(state, i));
  }
  return out;
}

/** Lowercase hexadecimal, two characters per byte. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * The hex SHA-256 of `text` encoded as UTF-8 — the same bytes
 * `createHash("sha256").update(text).digest("hex")` hashes in Node, where
 * `update(string)` defaults to UTF-8.
 *
 * @param text - the message
 * @returns 64 lowercase hex characters
 */
export function sha256Hex(text: string): string {
  return toHex(sha256(new TextEncoder().encode(text)));
}

/**
 * `docs/07` §9.1's hashing mechanics: {@link stableStringify},
 * {@link CACHE_SCHEMA_VERSION}, and one generic key helper (`P3-T33`).
 *
 * The per-purpose key builders §9.1 also sketches (`sourceResponseKey`,
 * `embeddingKey`, `llmCompletionKey`) belong to the cards that cache those
 * things. {@link summaryKey} is `P3-T26`'s: `docs/06` §11.2's components,
 * read as that section's "Decided 2026-10-23" note records — each keyed
 * prompt's `cacheEpoch`, not its full version string, so a PATCH bump keeps
 * cached summaries (corrected 2026-10-23, owner, `plan/00` §6 item 273(a)).
 * {@link encodeTagValue} is the one escape for a cache tag's value: the
 * summary cache and the job runner's pinned tags both use it (item 273(c)).
 *
 * ## Why SHA-256 is computed here, synchronously
 *
 * §9.1's builders are synchronous (`return sha256([...].join("|"))`), and
 * `crypto.subtle.digest` is not. `core/` may import only `model/`, so no
 * platform hash can be imported either. {@link sha256Hex} is FIPS 180-4's
 * SHA-256 over the UTF-8 bytes of a string, checked in
 * `test/unit/core/cache.test.ts` against Node's `crypto` and the standard
 * test vectors. It is a cache key, not a security boundary.
 */

import type { ProviderId } from "../../model/ids";
import type { SourceTier } from "../../model/summary";

/** Bumped whenever the shape of a cached value changes. */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * JSON with every object's keys sorted, recursively — so `{a:1,b:2}` and
 * `{b:2,a:1}` are one string (§9.1: "Without it … the hit rate silently
 * collapses").
 *
 * Follows `JSON.stringify` otherwise: `toJSON` is honoured, an `undefined`,
 * function or symbol member is left out of an object and written `null` in an
 * array, and a non-finite number is `null`. Array order is kept: it is data.
 *
 * @throws TypeError for a `bigint`, or for a cycle — neither has a JSON form
 */
export function stableStringify(value: unknown): string {
  const out = encode(value, new Set<object>());
  return out ?? "null";
}

/** One value's canonical JSON, or `undefined` for a value JSON leaves out. */
function encode(value: unknown, path: Set<object>): string | undefined {
  if (value !== null && typeof value === "object") {
    const withToJson = value as { toJSON?: unknown };
    if (typeof withToJson.toJSON === "function") {
      return encode((withToJson.toJSON as () => unknown).call(value), path);
    }
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "bigint":
      throw new TypeError(
        "[research-helper] stableStringify cannot encode a bigint",
      );
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }
  if (value === null) return "null";
  const object = value as object;
  if (path.has(object)) {
    throw new TypeError(
      "[research-helper] stableStringify cannot encode a cycle",
    );
  }
  path.add(object);
  try {
    if (Array.isArray(object)) {
      return `[${(object as unknown[])
        .map((item) => encode(item, path) ?? "null")
        .join(",")}]`;
    }
    const record = object as Record<string, unknown>;
    const members: string[] = [];
    for (const name of Object.keys(record).sort()) {
      const encoded = encode(record[name], path);
      if (encoded !== undefined) {
        members.push(`${JSON.stringify(name)}:${encoded}`);
      }
    }
    return `{${members.join(",")}}`;
  } finally {
    path.delete(object);
  }
}

/**
 * The generic key: the SHA-256 hex digest of
 * `stableStringify(["v<CACHE_SCHEMA_VERSION>", kind, ...parts])`.
 *
 * An array rather than §9.1's `parts.join("|")`, so a part that contains a
 * `|` cannot make two different part lists one key. `CACHE_SCHEMA_VERSION` is
 * the first component, so a bump makes every key miss (§9.3 trigger 4).
 *
 * @param kind - what is keyed, e.g. `"source"`; one word per key builder
 * @param parts - everything that could change the cached value (§9.1)
 */
export function cacheKey(kind: string, ...parts: readonly unknown[]): string {
  return sha256Hex(
    stableStringify([`v${String(CACHE_SCHEMA_VERSION)}`, kind, ...parts]),
  );
}

// ---------------------------------------------------------------------------
// The summary key — docs/06 §11.2 (`P3-T26`)
// ---------------------------------------------------------------------------

/** {@link summaryKey}'s `kind`: §11.2's `'ps'` namespace component. */
export const SUMMARY_KEY_KIND = "ps";

/**
 * Everything `docs/06` §11.2 keys a paper summary on, read as that section's
 * "Decided 2026-10-23" note records. Every member is load-bearing: changing
 * any one of them must miss.
 */
export interface SummaryKeyInput {
  readonly libraryID: number;
  /** The Zotero item key of the summarized (parent) item. */
  readonly itemKey: string;
  /**
   * `AcquiredSource.contentHash`: the hash of the **cleaned** text actually
   * sent (`docs/06` §4.1 runs before it is taken), never of the file, the raw
   * extractor text or `dateModified`. If a later stage cuts the text again
   * before sending it, this must be the hash of the cut text.
   */
  readonly contentHash: string;
  /** §11.2's `src.tier`: an abstract summary never satisfies a full-text request. */
  readonly tier: SourceTier;
  /**
   * `docs/07` §5.2's `SummaryInputScope["kind"]` — what the privacy policy
   * let the model see (`P3-T15`'s `planInputScopeKind`).
   */
  readonly inputScopeKind: string;
  /** `PAPER_SUMMARY_ABSTRACT` | `PAPER_SUMMARY_FULLTEXT` | `CHUNK_REDUCE`. */
  readonly promptId: string;
  /**
   * The `cacheEpoch` of every prompt whose output the summary contains:
   * `promptId`'s own (required), and `CHUNK_MAP`'s too for a `CHUNK_REDUCE`
   * summary. Not the full version string: the registry holds `cacheEpoch`
   * equal across a PATCH bump, so a PATCH bump keeps the key (`docs/12`
   * §17.2; owner, 2026-10-23, `plan/00` §6 item 273(a); this was
   * `promptVersions`, keyed on the version strings).
   */
  readonly promptCacheEpochs: Readonly<Record<string, number>>;
  /**
   * Every user-message variable of the prompt except the acquired text —
   * title, authors, year, venue, item type, DOI, tags, tier, completeness
   * note — because the model is shown them too.
   */
  readonly promptMetadata: Readonly<Record<string, string>>;
  /** `PaperSummary`'s schema version, e.g. `"paper-summary-v1"`. */
  readonly schemaVersion: string;
  readonly providerId: ProviderId;
  /** The pinned, dated model identifier the request names. */
  readonly modelId: string;
  /** The sampling temperature the request sends. */
  readonly temperature: number;
}

/** How {@link summaryKey} is asked for its key. */
export interface SummaryKeyOptions {
  /**
   * `cache.ignoreModel`'s key: the model component is replaced by `null`, a
   * value no model identifier (a string) can equal. The provider stays.
   */
  readonly anyModel?: boolean;
}

function requireText(name: string, value: string): void {
  if (value === "") {
    throw new RangeError(`[research-helper] summaryKey: ${name} is empty`);
  }
}

/**
 * The summary cache key: SHA-256 of `stableStringify` over
 * `["v<CACHE_SCHEMA_VERSION>", "ps", …§11.2's components]`, in §11.2's
 * order, with the input scope kind after the tier and the prompt metadata
 * after the schema version.
 *
 * Not `StoredSummary.id` (`workKey:promptVersion:modelId`, `docs/07` §5.2):
 * that id names "the current summary of this work"; this key names one exact
 * input.
 *
 * @throws RangeError for an empty identifying component, a
 *   `promptCacheEpochs` map without a positive integer for `promptId`, or a
 *   non-finite temperature — a key built from a hole would match another hole
 */
export function summaryKey(
  input: SummaryKeyInput,
  options: SummaryKeyOptions = {},
): string {
  requireText("itemKey", input.itemKey);
  requireText("contentHash", input.contentHash);
  requireText("promptId", input.promptId);
  requireText("schemaVersion", input.schemaVersion);
  requireText("modelId", input.modelId);
  const ownEpoch = input.promptCacheEpochs[input.promptId];
  if (ownEpoch === undefined || !Number.isInteger(ownEpoch) || ownEpoch < 1) {
    throw new RangeError(
      `[research-helper] summaryKey: no cacheEpoch for ${input.promptId}`,
    );
  }
  if (!Number.isFinite(input.temperature)) {
    throw new RangeError(
      "[research-helper] summaryKey: temperature is not finite",
    );
  }
  return cacheKey(
    SUMMARY_KEY_KIND,
    input.libraryID,
    input.itemKey,
    input.contentHash,
    input.tier,
    input.inputScopeKind,
    input.promptId,
    input.promptCacheEpochs,
    input.schemaVersion,
    input.promptMetadata,
    input.providerId,
    options.anyModel === true ? null : input.modelId,
    input.temperature,
  );
}

// ---------------------------------------------------------------------------
// Tag values — docs/07 §9.3, docs/06 §11.2 reading 8
// ---------------------------------------------------------------------------

/**
 * A tag value with `%` and `,` escaped: `cache_entry.tags` is comma-joined,
 * so a comma inside a value (a DOI may hold one) would split the tag, and the
 * cache refuses a tag that contains one.
 *
 * The one escape for a tag's value. It lives here, in `core/`, so that both
 * the summary cache (`src/pipeline/summarize/summaryCache.ts`, which
 * re-exports it) and the job runner's pinned tags (`RunningWork.pinnedTags`
 * in `src/core/jobQueue/queue.ts`) apply it: a `work:` tag written one way
 * and pinned another would leave a running job's entries evictable
 * (owner, 2026-10-23, `plan/00` §6 item 273(c)).
 *
 * @param value - any string
 * @returns `value` with `%` written `%25` and `,` written `%2C`
 */
export function encodeTagValue(value: string): string {
  return value.replace(/%/g, "%25").replace(/,/g, "%2C");
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

const K = new Uint32Array([
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
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Lower-case hex SHA-256 of `text`'s UTF-8 bytes.
 *
 * @param text - any string
 * @returns 64 hexadecimal characters
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  // Message, the 0x80 marker, zero padding, and the 64-bit length.
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}

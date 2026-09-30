/**
 * Identifier types, adapter identity unions, and identifier normalization.
 *
 * **Scope.** `P1-T01`, the shipped module. It replaces the `P0-T12` spike
 * version, which carried only the `Doi` brand and `normalizeDoi`;
 * `plan/README.md` §4 lists `src/model/ids.ts` among the sixteen paths where a
 * later card's `create` wins, so nothing the spike left here was load-bearing.
 *
 * **Authority.** Every type below is transcribed from
 * `docs/07-architecture-and-data-model.md` §5.1, which `plan/README.md` §5
 * rule 3 makes the sole authority for types. `docs/02` §10.1 and §12.1 carry
 * deliberately divergent working-name sketches (`ids.s2PaperId`, `ids.epmc`)
 * under explicit "doc 07 wins" notes; they are not transcribed here, and
 * `P1-T01`'s **Do NOT** list names adding an `epmc` id as a defect.
 *
 * **Layering.** `model/` imports nothing but `model/` (docs/07 §2.3) and never
 * references `Zotero.*`; both are enforced by `eslint.config.js`. That rule is
 * also why the `SourceId` / `ProviderId` unions live here rather than in
 * `sources/types.ts` / `llm/types.ts` — model types reference them, so
 * declaring them in an adapter would make `model/ ↔ sources/` circular — and
 * why {@link sha1Hex} below is a dependency-free implementation rather than a
 * call to `crypto.subtle` or an import of Node's `crypto`.
 */

// ---------------------------------------------------------------------------
// 1. Branded identifier types — docs/07 §5.1, verbatim
// ---------------------------------------------------------------------------

/** Branded string types so a DOI can never be passed where a PMID is expected. */
export type Doi = string & { readonly __brand: "Doi" }; // lowercase, no prefix
export type Pmid = string & { readonly __brand: "Pmid" }; // digits only
export type Pmcid = string & { readonly __brand: "Pmcid" }; // "PMC" + digits
export type ArxivId = string & { readonly __brand: "ArxivId" }; // "2401.01234" (no version)
export type S2CorpusId = string & { readonly __brand: "S2CorpusId" };
export type OpenAlexId = string & { readonly __brand: "OpenAlexId" };

/**
 * Adapter identity unions. They live here, not in `sources/types.ts` / `llm/types.ts`,
 * because model types reference them and `model/` may not import from adapters (§2.3).
 * Both adapter modules re-export these.
 *
 * `openalex` is RESERVED, not shipped: OpenAlex is out of v1 (decision D2,
 * `00-overview.md` §3; `10-requirements-and-user-stories.md` §4 item 10;
 * `02-literature-database-apis.md` §9.3), no adapter is registered for it, and no record
 * ever carries it. It stays in the union so that the reserved id, the `OpenAlexId` brand
 * and the `ExternalIds.openAlexId` slot below cannot be reused for something else, and so
 * that doc 02's mirrored copy of this union does not have to diverge. The v1 rules that
 * follow from that: nothing may put `openalex` in the `sources` preference (§8.5), §7.3's
 * policy table has no `api.openalex.org` row, and doc 02 §10.4's precedence entries for
 * OpenAlex are inert.
 */
export type SourceId =
  | "pubmed"
  | "europepmc"
  | "crossref"
  | "semanticscholar"
  | "arxiv"
  | "biorxiv"
  | "medrxiv"
  | "openalex";

export type ProviderId = "openrouter" | "openai" | "gemini" | "anthropic";

/**
 * The runtime mirror of {@link SourceId}, and the only one.
 *
 * This is **not** a second declaration of the union (`P1-T01`'s **Do NOT**):
 * the `satisfies Record<SourceId, true>` below ties it to the union above at
 * compile time, so adding a member to one without the other fails to compile
 * — which is exactly what `docs/07` §11.1 step 3 ("TypeScript will now flag
 * every exhaustive `switch`") asks for. It exists because `P1-T01` step 5's
 * type guards have to validate `WorkProvenance.seenIn` at runtime and a bare
 * union erases.
 *
 * `openalex` is present for the reason the union gives: the id is reserved,
 * not shipped. {@link isSourceId} therefore accepts it, and keeping it out of
 * the `sources` preference (§8.5) is a separate rule enforced elsewhere.
 */
const SOURCE_ID_SET = {
  pubmed: true,
  europepmc: true,
  crossref: true,
  semanticscholar: true,
  arxiv: true,
  biorxiv: true,
  medrxiv: true,
  openalex: true,
} satisfies Record<SourceId, true>;

/** Every {@link SourceId}, in the union's declaration order. */
export const SOURCE_IDS: readonly SourceId[] = Object.keys(
  SOURCE_ID_SET,
) as SourceId[];

/** Type guard: is `value` one of the eight {@link SourceId} members? */
export function isSourceId(value: unknown): value is SourceId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SOURCE_ID_SET, value)
  );
}

/**
 * External identifiers. All fields optional: a bioRxiv preprint may have only a DOI,
 * an old PubMed record may have only a PMID.
 */
export interface ExternalIds {
  readonly doi?: Doi;
  readonly pmid?: Pmid;
  readonly pmcid?: Pmcid;
  readonly arxivId?: ArxivId;
  readonly s2CorpusId?: S2CorpusId;
  readonly openAlexId?: OpenAlexId;
  /** Fallback URL when no stable identifier exists. */
  readonly url?: string;
}

// ---------------------------------------------------------------------------
// 2. Normalizers — docs/02 §11.1, §10.2
//
// All three share one shape: `(raw: string | null | undefined) => T | null`.
// A source that omitted the field, spelled it in a form this plugin does not
// recognise, or sent something that is not an identifier at all all collapse
// to `null`, so a caller has exactly one case to handle.
// ---------------------------------------------------------------------------

/** `10.` + a 4–9 digit registrant + `/` + a non-empty, whitespace-free suffix. */
const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;

/** A bare, unsigned decimal integer. */
const DIGITS_ONLY = /^\d+$/;

/**
 * Normalize a DOI to the single spelling this plugin stores, displays, keys on
 * and writes to Zotero.
 *
 * The body is `docs/02` §11.1's reference implementation, unchanged; the
 * return type is narrowed to the branded {@link Doi} of `docs/07` §5.1.
 *
 * There is deliberately **no** second, original-spelling output. `docs/02`
 * §11.1 withdrew that instruction ("`normalizeDoi()`'s lowercase output is the
 * only DOI the plugin stores, displays, or writes to Zotero"), {@link
 * ExternalIds} has nowhere to put it, `docs/07` §6.2 maps `ids.doi` straight
 * into Zotero's `DOI` field, and `docs/10` FR-6 requires the lowercase form.
 * This was conflict `C9` in `plan/02-phase-1-pubmed.md` §4 and it is closed.
 * §11.1's remaining caution — that a handful of publishers advertise
 * case-sensitive-looking DOIs — is a caution, not an instruction to widen the
 * model: DOIs are case-insensitive for resolution, so the lowercase form
 * resolves identically.
 *
 * @param raw - a DOI as some source spelled it, or nothing
 * @returns the normalized DOI, or `null` if `raw` is not a syntactic DOI
 */
export function normalizeDoi(raw: string | null | undefined): Doi | null {
  if (!raw) return null;
  let d = String(raw).trim();
  // Strip resolver prefixes and the doi: scheme (OpenAlex sends full URLs).
  d = d
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/^info:doi\//i, "");
  // Strip surrounding angle brackets / quotes seen in some deposits.
  d = d.replace(/^[<"']+|[>"']+$/g, "");
  // Trailing punctuation from text extraction.
  d = d.replace(/[.,;)\]]+$/, "");
  // DOIs are case-insensitive; lowercase for comparison.
  d = d.toLowerCase();
  // Percent-decode once (some sources over-encode the suffix).
  try {
    if (/%[0-9a-f]{2}/i.test(d)) d = decodeURIComponent(d);
  } catch {
    /* keep as-is */
  }
  return DOI_SHAPE.test(d) ? (d as Doi) : null;
}

/**
 * Normalize a PubMed ID to the bare-digits form `docs/07` §5.1 brands
 * ("digits only").
 *
 * Every source that supplies one supplies it bare — `docs/02` §10.2 maps
 * PubMed's `PMID` element and Semantic Scholar's `externalIds.PubMed` with no
 * transformation — so the only spelling variance this has to survive is the
 * labelled `PMID: 12345678` line that `docs/07` §6.3 writes into Zotero's
 * `extra` for item types with no native field, and that §6.6 reads back.
 *
 * @param raw - a PMID as some source or an `extra` line spelled it, or nothing
 * @returns the bare-digits PMID, or `null` if `raw` is not one
 */
export function normalizePmid(raw: string | null | undefined): Pmid | null {
  if (!raw) return null;
  const p = String(raw)
    .trim()
    .replace(/^pmid\s*:\s*/i, "")
    .trim();
  return DIGITS_ONLY.test(p) ? (p as Pmid) : null;
}

/**
 * Normalize a PubMed Central ID to the prefixed form `docs/07` §5.1 brands
 * (`"PMC" + digits`), **adding the prefix when the source omitted it**.
 *
 * That last clause is the whole reason this function is not a regex test:
 * `docs/02` §10.2's Semantic Scholar row is `externalIds.PubMedCentral` with
 * the explicit instruction *"add `PMC`"*, while Europe PMC's `pmcid` and
 * PubMed's `ArticleId[@IdType='pmc']` already carry it. Two spellings of one
 * identifier would key two cache entries and defeat §11.3's cascade.
 *
 * @param raw - a PMCID with or without the `PMC` prefix, or nothing
 * @returns the `PMC`-prefixed PMCID, or `null` if `raw` is not one
 */
export function normalizePmcid(raw: string | null | undefined): Pmcid | null {
  if (!raw) return null;
  const digits = String(raw)
    .trim()
    .replace(/^pmcid\s*:\s*/i, "")
    .trim()
    .replace(/^pmc/i, "");
  return DIGITS_ONLY.test(digits) ? (`PMC${digits}` as Pmcid) : null;
}

// ---------------------------------------------------------------------------
// 3. The work key — docs/07 §5.1's `CanonicalWork.workKey` doc comment
// ---------------------------------------------------------------------------

/**
 * Build the stable internal key `docs/07` §5.1 specifies for
 * `CanonicalWork.workKey`: the first available of
 * `doi:<doi>` | `pmid:<pmid>` | `arxiv:<id>` | `s2:<corpusId>` |
 * `hash:<sha1(title|year|firstAuthor)>`.
 *
 * The order is load-bearing, not cosmetic. It is the primary key in the plugin
 * database, a cache-key component (§9.1), and the value written to Zotero's
 * `extra` as `rh-work-key` (§6.2); §6.6 derives the same key again when it
 * reads an item back, so the same inputs must always produce the same string.
 *
 * The identifiers are taken as already-normalized branded values — call
 * {@link normalizeDoi} / {@link normalizePmid} before populating
 * {@link ExternalIds}, never after — because a case-variant DOI here would
 * produce a key that no later read reproduces.
 *
 * > **Under-specified upstream.** `docs/07` §5.1 writes the hash arm as
 * > `sha1(title|year|firstAuthor)` and stops there: it does not say whether
 * > the title is case-folded, whitespace-collapsed or punctuation-stripped
 * > first, nor what stands in for an absent year or author. This
 * > implementation therefore does the literal thing and documents it — the
 * > three components are joined with `|` exactly as given, an absent `year` or
 * > `firstAuthor` contributes an empty component, and no other normalization
 * > is applied. Fuzzy title matching is `docs/02` §11.3's cascade, a different
 * > mechanism with a different owner (`P2-T09`); do not fold it in here.
 *
 * @param ids - normalized external identifiers for the work
 * @param title - the work's title, as the winning source gave it
 * @param year - the publication year, when known
 * @param firstAuthor - the first author's family name, when known
 * @returns the work key; never empty, because the hash arm always applies
 */
export function buildWorkKey(
  ids: ExternalIds,
  title: string,
  year?: number,
  firstAuthor?: string,
): string {
  if (ids.doi) return `doi:${ids.doi}`;
  if (ids.pmid) return `pmid:${ids.pmid}`;
  if (ids.arxivId) return `arxiv:${ids.arxivId}`;
  if (ids.s2CorpusId) return `s2:${ids.s2CorpusId}`;
  return `hash:${sha1Hex(`${title}|${year ?? ""}|${firstAuthor ?? ""}`)}`;
}

// ---------------------------------------------------------------------------
// 4. SHA-1 — dependency-free, because model/ may not reach for a platform API
//
// P1-T01's Notes: "`sha1` must come from a dependency-free implementation or
// from `crypto.subtle` behind an injected port — docs/07 §2.3 forbids `model/`
// reaching for a platform global". The injected-port option is not open here:
// §5.1 fixes `buildWorkKey`'s inputs, and `crypto.subtle.digest` is async, so
// a port would make every caller of a pure key-builder await. Hence FIPS 180-4
// in ~40 lines. It is a *key* derivation, never a security primitive; nothing
// in this plugin authenticates anything with it.
// ---------------------------------------------------------------------------

/** 32-bit left rotate, returned unsigned. */
function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/**
 * UTF-8 encode a string to a byte array.
 *
 * Hand-written rather than `new TextEncoder()` for the same reason SHA-1 is:
 * `TextEncoder` is a platform global, and `model/` takes no platform
 * capability it did not receive as an argument. Lone surrogates — which no
 * real title contains — encode to their WTF-8 three-byte form rather than
 * `TextEncoder`'s U+FFFD; the only consequence is that such a title hashes to
 * a different (still stable) key.
 */
function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(
        0xe0 | (cp >> 12),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

/**
 * SHA-1 of a string's UTF-8 bytes, as 40 lowercase hex characters.
 *
 * Exported because the hash arm of {@link buildWorkKey} has to be assertable
 * against the published test vectors of FIPS 180-4 — `""` →
 * `da39a3ee5e6b4b0d3255bfef95601890afd80709`, `"abc"` →
 * `a9993e364706816aba3e25717850c26c9cd0d89d` — rather than only against
 * itself.
 */
export function sha1Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;

  // Pad: 0x80, then zeros to 56 mod 64, then the big-endian 64-bit bit length.
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) {
    bytes.push(
      (word >>> 24) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 8) & 0xff,
      word & 0xff,
    );
  }

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Array<number>(80).fill(0);
  for (let block = 0; block < bytes.length; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = block + i * 4;
      w[i] =
        (((bytes[at] ?? 0) << 24) |
          ((bytes[at + 1] ?? 0) << 16) |
          ((bytes[at + 2] ?? 0) << 8) |
          (bytes[at + 3] ?? 0)) >>>
        0;
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl32(
        (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0),
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = ((b & c) | (~b & d)) >>> 0;
        k = 0x5a827999;
      } else if (i < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }
      const t = (rotl32(a, 5) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl32(b, 30);
      b = a;
      a = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

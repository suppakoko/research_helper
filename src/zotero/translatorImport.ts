/**
 * Strategy B: import through Zotero's own identifier lookup
 * (`Zotero.Translate.Search`), with hand-mapping as the per-record fallback
 * (`P2-T18`; `docs/01` §6.2, §6.3 item 3; `docs/07` §8.5, §12.1).
 *
 * **Only reached when `useTranslators` is on**, which it ships **off**
 * (`docs/07` §8.5). The preference is read once per run by the writer in
 * `src/bootstrap/registerPipelines.ts`, on the first batch of `WritingItems`,
 * and this module is handed the result as {@link TranslatorImportOptions}
 * through `ImportRequest.translatorLookup`. Nothing here reads a preference.
 *
 * **Every `Zotero.Translate` reference in the plugin is in this file.**
 * `docs/01` §6.2's closing warning: `Zotero.Translate.Search` is undocumented
 * internal API with no stability guarantee across major versions, and
 * `docs/11` R-1's mitigation is that a break stays inside `src/zotero/`. A
 * thrown lookup is one record's fallback, never the run's failure.
 *
 * **What this module decides, and what it leaves to the importer.** It derives
 * one identifier per record, runs the lookups, and reports, per record, either
 * the item Zotero's translator saved or the reason the record falls back to
 * Strategy A. The importer (`./importer.ts`) then applies `docs/01` §6.3 step
 * 4's abstract repair and `P2-T08`'s preprint attribution to the saved items,
 * and hand-maps the fallbacks exactly as it hand-maps every record when the
 * preference is off.
 *
 * ## The rules, each from a `Read first` section
 *
 * - **Identifier priority is Zotero's own:** DOI, then arXiv ID, then PMID —
 *   `Zotero.Utilities.extractIdentifiers`'s strict order (`docs/01` §6.2,
 *   ISBN and ADS bibcode omitted because a `CanonicalWork` carries neither).
 *   The identifier object is built from the merged record's own fields rather
 *   than from text, so the loose PMID regex `extractIdentifiers` falls back
 *   to never runs on anything.
 * - **The whole translator list goes to `setTranslator`**, never
 *   `translators[0]`: `Zotero.Translate.Search.prototype.complete` falls
 *   through to the next translator when one fails (`docs/01` §6.2).
 * - **PMID-only records are batched {@link PMID_LOOKUP_BATCH_SIZE} to a
 *   lookup** as `{ PMID: [id1, id2, …] }`, copying Zotero's own bulk lookup
 *   (`docs/01` §6.2). One search per batch, so a batch's failure is every
 *   member's fallback, and a member the batch returned no item for falls back
 *   as `"no-result"`.
 * - **A PMCID never reaches `setIdentifier`.** `docs/01` §6.2: PMCID "is not
 *   recognised at all". A record whose only identifier is a PMCID is resolved
 *   first through {@link TranslatorImportOptions.resolvePmcids} (the Europe PMC
 *   route `docs/01` §6.2 names); one that still has no DOI, arXiv ID or PMID
 *   falls back as `"no-identifier"` without a lookup attempt.
 * - **The per-record deadline has no number.** `docs/07` §12.1 and `docs/01`
 *   §6.3 item 3 say a record falls back "on failure or timeout", and no
 *   document gives the timeout's value (`plan/README.md` §5 rule 4). So
 *   {@link TranslatorImportOptions.perRecordTimeoutMs} has **no default**:
 *   absent, a lookup runs until the translator settles. The mechanism is built
 *   and tested; choosing the figure is reported as an owner decision.
 */

import type { Logger } from "../core/logger";
import { OperationCancelledError, ResearchHelperError } from "../core/errors";
import type { CancellationToken } from "../core/jobQueue/cancellation";
import type { CanonicalWork } from "../model/canonicalWork";

// ---------------------------------------------------------------------------
// 1. Vocabulary
// ---------------------------------------------------------------------------

/**
 * `docs/01` §6.2: "Zotero's own lookup batches PubMed IDs 200 at a time as
 * `[{ PMID: [id1, id2, …] }]` — worth copying for bulk imports."
 */
export const PMID_LOOKUP_BATCH_SIZE = 200;

/**
 * `translate({ … saveAttachments })`. `true`, as in `docs/01` §6.2's
 * `importByIdentifier` reference implementation, because §6.3 item 3's reason
 * for the opt-in path is "Zotero-canonical metadata plus any OA PDF".
 */
export const TRANSLATOR_SAVE_ATTACHMENTS = true;

/** Which path produced an item: Strategy B or Strategy A (`docs/01` §6.3). */
export type ImportPath = "translator" | "hand-map";

/**
 * Why a record went to Strategy A while `useTranslators` was on.
 *
 * - `"no-identifier"` — no DOI, arXiv ID or PMID, even after the PMCID route
 *   (`P2-T18` step 6): no lookup was attempted.
 * - `"lookup-error"` — the lookup threw (`docs/01` §6.2's `ERROR_NO_RESULTS`
 *   and every other translator failure arrive this way).
 * - `"no-translators"` — `getTranslators()` returned an empty list.
 * - `"no-result"` — `translate()` returned no item for the record.
 * - `"timeout"` — {@link TranslatorImportOptions.perRecordTimeoutMs} expired.
 */
export type TranslatorFallbackReason =
  "no-identifier" | "lookup-error" | "no-translators" | "no-result" | "timeout";

/** Every {@link TranslatorFallbackReason}, in declaration order. */
export const TRANSLATOR_FALLBACK_REASONS: readonly TranslatorFallbackReason[] =
  ["no-identifier", "lookup-error", "no-translators", "no-result", "timeout"];

/**
 * What `setIdentifier` is given. `docs/01` §6.2: it accepts `DOI`, `ISBN`,
 * `PMID`, `arXiv` and `adsBibcode` — and never a PMCID.
 */
export type TranslatorIdentifier =
  | { readonly DOI: string }
  | { readonly arXiv: string }
  | { readonly PMID: string | readonly string[] };

/** `translate()`'s options, as `docs/01` §6.2's loop passes them. */
export interface TranslateOptions {
  readonly libraryID: number;
  readonly collections: number[] | false;
  readonly saveAttachments: boolean;
}

/**
 * The four calls of `Zotero.Translate.Search` this module makes — the seam a
 * test fakes. `zotero-types` declares `Zotero.Translate` as `any`, so this is
 * also the only typing the API has here.
 */
export interface TranslatorSearch {
  setIdentifier(identifier: TranslatorIdentifier): void;
  getTranslators(): Promise<readonly unknown[]>;
  setTranslator(translators: readonly unknown[]): void;
  translate(options: TranslateOptions): Promise<readonly Zotero.Item[]>;
}

/** Constructs one {@link TranslatorSearch} per lookup. */
export type TranslatorSearchFactory = () => TranslatorSearch;

/** A PMCID's other identifiers, as the Europe PMC route returns them. */
export interface ResolvedPmcid {
  readonly doi?: string;
  readonly pmid?: string;
}

/**
 * The PMCID route of `P2-T18` step 6: PMCIDs in, the DOI or PMID each one
 * resolves to out. A PMCID absent from the map did not resolve.
 */
export type PmcidResolver = (
  pmcids: readonly string[],
  token: CancellationToken | undefined,
) => Promise<ReadonlyMap<string, ResolvedPmcid>>;

/** What Strategy B needs beyond the records and the destination. */
export interface TranslatorImportOptions {
  /** Defaults to {@link createZoteroTranslatorSearch}. Tests pass a fake. */
  readonly createSearch?: TranslatorSearchFactory;
  /**
   * The Europe PMC route for PMCID-only records. Absent, such a record falls
   * back as `"no-identifier"` without a lookup — which is the safe half of
   * step 6 and never sends a PMCID to `setIdentifier`.
   */
  readonly resolvePmcids?: PmcidResolver;
  /**
   * The deadline for one lookup (one `getTranslators()` + `translate()`), in
   * ms. **No default, deliberately** — see this file's header: no document
   * gives the number. A PMID batch is one lookup and gets one deadline.
   */
  readonly perRecordTimeoutMs?: number;
  /** The timer the deadline waits on. Defaults to `Zotero.Promise.delay`. */
  readonly delay?: (ms: number) => Promise<void>;
  /**
   * Awaited before the first lookup. Defaults to
   * `Zotero.Schema.schemaUpdatePromise`, which `docs/01` §6.2's
   * `importByIdentifier` opens with.
   */
  readonly schemaReady?: () => Promise<unknown>;
  /** Every fallback is logged here at `warn`, with its reason. */
  readonly logger?: Logger;
}

/** One record Strategy B imported, with the item the translator saved. */
export interface TranslatedWork {
  readonly work: CanonicalWork;
  readonly item: Zotero.Item;
}

/** One record that goes to Strategy A, and why. */
export interface TranslatorFallback {
  readonly work: CanonicalWork;
  readonly reason: TranslatorFallbackReason;
  /** The thrown error's `code`, for `"lookup-error"` only. */
  readonly code?: string;
}

/** What {@link lookupThroughTranslators} hands back. */
export interface TranslatorLookupResult {
  /** In input order. */
  readonly translated: readonly TranslatedWork[];
  /** In input order. */
  readonly fallbacks: readonly TranslatorFallback[];
  /** `Translate.Search` objects constructed — one per lookup. */
  readonly searches: number;
}

/** {@link lookupThroughTranslators}'s inputs. */
export interface TranslatorLookupRequest {
  readonly works: readonly CanonicalWork[];
  readonly libraryID: number;
  /** The target collection; `translate()` saves straight into it. */
  readonly collectionID: number;
  readonly token?: CancellationToken;
  readonly options: TranslatorImportOptions;
}

// ---------------------------------------------------------------------------
// 2. The production seam — the only `Zotero.Translate` reference
// ---------------------------------------------------------------------------

/** `new Zotero.Translate.Search()`, typed to the four calls used here. */
export function createZoteroTranslatorSearch(): TranslatorSearch {
  const translate = Zotero.Translate as {
    Search: new () => TranslatorSearch;
  };
  return new translate.Search();
}

// ---------------------------------------------------------------------------
// 3. Identifiers
// ---------------------------------------------------------------------------

/**
 * The identifier `setIdentifier` gets for `work`, in `extractIdentifiers`'s
 * priority (DOI → arXiv → PMID), or `undefined` when it has none of the three.
 * A PMCID is never returned — it is not a `setIdentifier` key.
 */
export function identifierFor(
  work: CanonicalWork,
): TranslatorIdentifier | undefined {
  const { doi, arxivId, pmid } = work.ids;
  if (doi !== undefined && doi !== "") return { DOI: doi };
  if (arxivId !== undefined && arxivId !== "") return { arXiv: arxivId };
  if (pmid !== undefined && pmid !== "") return { PMID: pmid };
  return undefined;
}

/** `[a … z]` → batches of at most `size`, in order. */
export function batchesOf<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size));
  }
  return out;
}

/**
 * The PMID a saved item carries: the native `PMID` field where the item type
 * has one, else a `PMID:` line in `extra` (`docs/07` §6.3's standard line).
 * `getField` returns `""` for a field the type lacks.
 */
export function pmidOfItem(item: Zotero.Item): string | undefined {
  const native = String(item.getField("PMID") ?? "").trim();
  if (native !== "") return native;
  const extra = String(item.getField("extra") ?? "");
  const match = /^PMID:\s*(\d+)\s*$/imu.exec(extra);
  return match?.[1];
}

// ---------------------------------------------------------------------------
// 4. The lookups
// ---------------------------------------------------------------------------

/** Thrown by the deadline race, and nowhere else. */
class LookupDeadline extends Error {}

type LookupOutcome =
  | { readonly kind: "items"; readonly items: readonly Zotero.Item[] }
  | {
      readonly kind: "fallback";
      readonly reason: TranslatorFallbackReason;
      readonly code?: string;
    };

/**
 * Run Strategy B over `works` and report, per record, the saved item or the
 * fallback reason.
 *
 * Lookups run one at a time, as `docs/01` §6.2's loop runs them, and outside
 * every transaction: each one is a network round trip, and `docs/01` §5.8
 * forbids holding a transaction open across one. Cancellation is checked
 * before every lookup; a cancel leaves already-saved items in the collection
 * and throws, as the importer's chunk boundary does.
 *
 * @throws OperationCancelledError when the token is cancelled
 */
export async function lookupThroughTranslators(
  request: TranslatorLookupRequest,
): Promise<TranslatorLookupResult> {
  const { options, token } = request;
  const createSearch = options.createSearch ?? createZoteroTranslatorSearch;
  const schemaReady =
    options.schemaReady ?? (() => Zotero.Schema.schemaUpdatePromise);
  const delay = options.delay ?? defaultDelay;

  token?.throwIfCancelled();
  await schemaReady();

  const order = new Map<CanonicalWork, number>();
  request.works.forEach((work, index) => order.set(work, index));

  const translated: TranslatedWork[] = [];
  const fallbacks: TranslatorFallback[] = [];
  let searches = 0;

  const fallBack = (
    work: CanonicalWork,
    reason: TranslatorFallbackReason,
    code?: string,
  ): void => {
    fallbacks.push({ work, reason, ...(code !== undefined && { code }) });
    options.logger?.warn(
      "searchImport: translator lookup fell back to hand-mapping",
      {
        workKey: work.workKey,
        reason,
        ...(code !== undefined && { code }),
      },
    );
  };

  // ---- partition: single lookups, PMID batches, PMCID-only, nothing ----
  const singles: { work: CanonicalWork; identifier: TranslatorIdentifier }[] =
    [];
  const byPmid: { work: CanonicalWork; pmid: string }[] = [];
  const pmcidOnly: CanonicalWork[] = [];

  const route = (work: CanonicalWork, identifier: TranslatorIdentifier) => {
    if ("PMID" in identifier) {
      byPmid.push({ work, pmid: String(identifier.PMID) });
    } else {
      singles.push({ work, identifier });
    }
  };

  for (const work of request.works) {
    const identifier = identifierFor(work);
    if (identifier !== undefined) route(work, identifier);
    else if (work.ids.pmcid !== undefined && work.ids.pmcid !== "") {
      pmcidOnly.push(work);
    } else fallBack(work, "no-identifier");
  }

  // ---- step 6: the PMCID route, before any lookup ----
  if (pmcidOnly.length > 0) {
    const resolved = await resolvePmcids(pmcidOnly, options, token);
    for (const work of pmcidOnly) {
      const hit = resolved.get(String(work.ids.pmcid));
      if (hit?.doi !== undefined && hit.doi !== "") {
        route(work, { DOI: hit.doi });
      } else if (hit?.pmid !== undefined && hit.pmid !== "") {
        route(work, { PMID: hit.pmid });
      } else {
        fallBack(work, "no-identifier");
      }
    }
  }

  /** One lookup, with the optional deadline around both awaits. */
  const lookup = async (
    identifier: TranslatorIdentifier,
  ): Promise<LookupOutcome> => {
    token?.throwIfCancelled();
    searches += 1;
    const run = async (): Promise<LookupOutcome> => {
      const search = createSearch();
      search.setIdentifier(identifier);
      const translators = await search.getTranslators();
      if (translators.length === 0) {
        return { kind: "fallback", reason: "no-translators" };
      }
      // The whole list — `docs/01` §6.2. Never `translators[0]`.
      search.setTranslator(translators);
      const items = await search.translate({
        libraryID: request.libraryID,
        collections: [request.collectionID],
        saveAttachments: TRANSLATOR_SAVE_ATTACHMENTS,
      });
      return items.length === 0
        ? { kind: "fallback", reason: "no-result" }
        : { kind: "items", items };
    };
    try {
      return await withDeadline(run(), options.perRecordTimeoutMs, delay);
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      if (error instanceof LookupDeadline) {
        return { kind: "fallback", reason: "timeout" };
      }
      return { kind: "fallback", reason: "lookup-error", code: codeOf(error) };
    }
  };

  // ---- DOI and arXiv: one lookup per record ----
  for (const { work, identifier } of singles) {
    const outcome = await lookup(identifier);
    if (outcome.kind === "fallback") {
      fallBack(work, outcome.reason, outcome.code);
      continue;
    }
    const [item, ...extra] = outcome.items;
    if (item === undefined) {
      fallBack(work, "no-result");
      continue;
    }
    if (extra.length > 0) {
      options.logger?.warn(
        "searchImport: a translator lookup saved more than one item; the " +
          "first is the record's, the rest stay in the collection uncounted",
        { workKey: work.workKey, extra: extra.length },
      );
    }
    translated.push({ work, item });
  }

  // ---- PMID: batched, `{ PMID: [...] }` ----
  for (const batch of batchesOf(byPmid, PMID_LOOKUP_BATCH_SIZE)) {
    const outcome = await lookup({ PMID: batch.map((entry) => entry.pmid) });
    if (outcome.kind === "fallback") {
      for (const { work } of batch) {
        fallBack(work, outcome.reason, outcome.code);
      }
      continue;
    }
    const byId = new Map<string, Zotero.Item>();
    for (const item of outcome.items) {
      const pmid = pmidOfItem(item);
      if (pmid !== undefined && !byId.has(pmid)) byId.set(pmid, item);
    }
    for (const { work, pmid } of batch) {
      const item = byId.get(pmid);
      if (item === undefined) fallBack(work, "no-result");
      else translated.push({ work, item });
    }
  }

  const byInput = <T extends { readonly work: CanonicalWork }>(
    a: T,
    b: T,
  ): number => (order.get(a.work) ?? 0) - (order.get(b.work) ?? 0);
  translated.sort(byInput);
  fallbacks.sort(byInput);
  return { translated, fallbacks, searches };
}

/**
 * Ask the PMCID route. A resolver that throws resolves nothing: the records
 * fall back as `"no-identifier"`, and the failure is logged, because a missing
 * identifier is a fallback rather than a failed run (`P2-T18`'s Do NOT).
 */
async function resolvePmcids(
  works: readonly CanonicalWork[],
  options: TranslatorImportOptions,
  token: CancellationToken | undefined,
): Promise<ReadonlyMap<string, ResolvedPmcid>> {
  const resolver = options.resolvePmcids;
  if (resolver === undefined) return new Map();
  token?.throwIfCancelled();
  const pmcids = [...new Set(works.map((work) => String(work.ids.pmcid)))];
  try {
    return await resolver(pmcids, token);
  } catch (error) {
    if (error instanceof OperationCancelledError) throw error;
    options.logger?.warn(
      "searchImport: the PMCID route failed; PMCID-only records are " +
        "hand-mapped",
      { pmcids: pmcids.length, code: codeOf(error) },
    );
    return new Map();
  }
}

/** `promise`, or a {@link LookupDeadline} after `ms` when `ms` is set. */
async function withDeadline<T>(
  promise: Promise<T>,
  ms: number | undefined,
  delay: (ms: number) => Promise<void>,
): Promise<T> {
  if (ms === undefined) return promise;
  return Promise.race([
    promise,
    delay(ms).then((): never => {
      throw new LookupDeadline();
    }),
  ]);
}

/** A thrown value's `code`, for the log line and the fallback record. */
function codeOf(error: unknown): string {
  if (error instanceof ResearchHelperError) return error.code;
  if (error instanceof Error && error.name !== "") return error.name;
  return "unknown";
}

function defaultDelay(ms: number): Promise<void> {
  return Zotero.Promise.delay(ms) as unknown as Promise<void>;
}

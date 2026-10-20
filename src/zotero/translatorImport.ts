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
 *   first through {@link TranslatorImportOptions.resolvePmcids} — the NCBI ID
 *   Converter of `docs/02` §3.7 (`idtype=pmcid`, owner 2026-10-19, `plan/00`
 *   §6 item 214), built in `src/sources/pubmed/idConverter.ts` and wired by
 *   the writer; one that still has no DOI, arXiv ID or PMID falls back as
 *   `"no-identifier"` without a lookup attempt.
 * - **The per-record deadline is {@link TRANSLATOR_LOOKUP_TIMEOUT_MS}, 30 s**
 *   (owner 2026-10-19, `plan/00` §6 item 213; `docs/07` §12.1's dated note).
 *   The writer in `src/bootstrap/registerPipelines.ts` applies it; this
 *   module's {@link TranslatorImportOptions.perRecordTimeoutMs} still has no
 *   default of its own, so a caller that passes none gets no deadline.
 * - **A PMID batch's deadline grows with the batch** (owner 2026-10-20,
 *   `plan/00` §6 item 227; `docs/07` §12.1's dated note): the per-record
 *   deadline plus {@link PMID_BATCH_DEADLINE_PER_PMID_MS} per PMID, never
 *   more than {@link PMID_BATCH_DEADLINE_CAP_MS} — see
 *   {@link pmidBatchDeadlineMs}. A lookup for one record keeps the
 *   per-record deadline.
 * - **A deadline abandons a lookup; it does not stop it.** Nothing here can
 *   cancel a running `translate()`, so a lookup that loses the race keeps
 *   running, and when it settles its items are already saved into the
 *   collection by Zotero, beside the record's hand-mapped copy. The late
 *   result is never counted, repaired or returned. **Item 227 (owner,
 *   2026-10-20): those late items are moved to the Zotero trash** when the
 *   lookup settles — the exact items that lookup's own `translate()` saved,
 *   and nothing else ({@link moveItemsToTrash}) — and the count is logged at
 *   `warn`. A lookup whose deadline passed before `translate()` started never
 *   starts it.
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

/**
 * The per-record translator deadline, in ms: **30 seconds**. Owner,
 * 2026-10-19 (`plan/00` §6 item 213), recorded first in `docs/07` §12.1. A
 * lookup that has not settled by then falls back to hand-mapping as
 * `"timeout"`. Applied by `createZoteroSearchImportWriter`, not here — see
 * {@link TranslatorImportOptions.perRecordTimeoutMs}.
 */
export const TRANSLATOR_LOOKUP_TIMEOUT_MS = 30_000;

/**
 * What a PMID batch adds to the per-record deadline for each PMID in it:
 * **1 second**. Owner, 2026-10-20 (`plan/00` §6 item 227), recorded first in
 * `docs/07` §12.1. See {@link pmidBatchDeadlineMs}.
 */
export const PMID_BATCH_DEADLINE_PER_PMID_MS = 1_000;

/**
 * The longest deadline a PMID batch can get: **5 minutes**. Owner,
 * 2026-10-20 (`plan/00` §6 item 227). At {@link PMID_LOOKUP_BATCH_SIZE} = 200
 * the formula reaches 230 s, so the cap binds only above 270 PMIDs.
 */
export const PMID_BATCH_DEADLINE_CAP_MS = 5 * 60_000;

/**
 * The deadline for one PMID lookup covering `pmidCount` records, given the
 * per-record deadline `perRecordMs` (`docs/07` §12.1, item 227): `perRecordMs`
 * for a single record, otherwise `perRecordMs` + {@link
 * PMID_BATCH_DEADLINE_PER_PMID_MS} × `pmidCount`, never above {@link
 * PMID_BATCH_DEADLINE_CAP_MS}. No per-record deadline means no deadline.
 */
export function pmidBatchDeadlineMs(
  pmidCount: number,
  perRecordMs: number | undefined,
): number | undefined {
  if (perRecordMs === undefined) return undefined;
  if (pmidCount <= 1) return perRecordMs;
  return Math.min(
    PMID_BATCH_DEADLINE_CAP_MS,
    perRecordMs + PMID_BATCH_DEADLINE_PER_PMID_MS * pmidCount,
  );
}

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
  /** Resolves with the items this call saved — Zotero's `newItems`. */
  translate(options: TranslateOptions): Promise<readonly Zotero.Item[]>;
  /**
   * The items this search object has saved so far. `Zotero.Translate`
   * appends each save of its own here (and resolves `translate()` with this
   * array), so after a `translate()` that rejected it still names exactly the
   * items saved before the failure. Read only for an abandoned lookup
   * (item 227); a fake may leave it out.
   */
  readonly newItems?: readonly Zotero.Item[];
}

/** Constructs one {@link TranslatorSearch} per lookup. */
export type TranslatorSearchFactory = () => TranslatorSearch;

/** A PMCID's other identifiers, as the PMCID route returns them. */
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
   * The PMCID route for PMCID-only records: the NCBI ID Converter
   * (`docs/02` §3.7, item 214), supplied by the writer. Absent, such a record
   * falls back as `"no-identifier"` without a lookup, and so does a PMCID the
   * route could not resolve — neither ever sends a PMCID to `setIdentifier`.
   */
  readonly resolvePmcids?: PmcidResolver;
  /**
   * The deadline for one lookup (one `getTranslators()` + `translate()`), in
   * ms. The product value is {@link TRANSLATOR_LOOKUP_TIMEOUT_MS}, applied by
   * the writer; **absent here means no deadline**, so a direct caller of
   * {@link lookupThroughTranslators} chooses its own. A PMID batch is one
   * lookup and gets one deadline, scaled by {@link pmidBatchDeadlineMs}
   * (item 227).
   */
  readonly perRecordTimeoutMs?: number;
  /** The timer the deadline waits on. Defaults to `Zotero.Promise.delay`. */
  readonly delay?: (ms: number) => Promise<void>;
  /**
   * Moves an abandoned lookup's late items to the Zotero trash and returns
   * how many it moved (item 227). Defaults to {@link moveItemsToTrash}.
   * Tests pass a fake.
   */
  readonly moveToTrash?: (items: readonly Zotero.Item[]) => Promise<number>;
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

  /**
   * One lookup, with the deadline `deadlineMs` (none when `undefined`) around
   * both awaits. A lookup that loses the race is handed to
   * {@link trashLateSaves}, which waits for it to settle.
   */
  const lookup = async (
    identifier: TranslatorIdentifier,
    deadlineMs: number | undefined,
  ): Promise<LookupOutcome> => {
    token?.throwIfCancelled();
    searches += 1;
    let search: TranslatorSearch | undefined;
    let abandoned = false;
    const run = async (): Promise<LookupOutcome> => {
      search = createSearch();
      search.setIdentifier(identifier);
      const translators = await search.getTranslators();
      if (translators.length === 0) {
        return { kind: "fallback", reason: "no-translators" };
      }
      // Item 227: the record has already gone to Strategy A, so a save
      // started now could only make a second copy. Nothing is saved yet.
      if (abandoned) return { kind: "fallback", reason: "timeout" };
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
    const running = run();
    try {
      return await withDeadline(running, deadlineMs, delay);
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      if (error instanceof LookupDeadline) {
        abandoned = true;
        trashLateSaves(running, () => search?.newItems, options);
        return { kind: "fallback", reason: "timeout" };
      }
      return { kind: "fallback", reason: "lookup-error", code: codeOf(error) };
    }
  };

  // ---- DOI and arXiv: one lookup per record ----
  for (const { work, identifier } of singles) {
    const outcome = await lookup(identifier, options.perRecordTimeoutMs);
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
    const outcome = await lookup(
      { PMID: batch.map((entry) => entry.pmid) },
      pmidBatchDeadlineMs(batch.length, options.perRecordTimeoutMs),
    );
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

/**
 * Item 227 (owner, 2026-10-20; `docs/07` §12.1): once an abandoned lookup
 * settles, move the items **it** saved to the Zotero trash, and log the count.
 *
 * Which items is decided by the lookup's own `Translate` object, never by
 * looking at the collection or the library: the array `translate()` resolves
 * with, or, when the lookup rejects, that object's `newItems` (the items it
 * saved before failing; `readNewItems`). Measured from Zotero 10.0.3's
 * `translate.js`: `translate()` resolves with `newItems`, which only that
 * object's own saves append to, and `Translate.Search` moves to its next
 * translator only while `newItems` is empty — so the list is exactly this
 * lookup's saves. An item another path created, or one already in the
 * library, cannot be on it.
 *
 * Runs detached: the import has already returned when this settles, so a
 * failure here is logged, never thrown. The log carries counts and an error
 * code only — no identifier, title or other record content.
 */
function trashLateSaves(
  running: Promise<LookupOutcome>,
  readNewItems: () => readonly Zotero.Item[] | undefined,
  options: TranslatorImportOptions,
): void {
  const moveToTrash = options.moveToTrash ?? moveItemsToTrash;
  void running
    .then(
      (outcome): readonly Zotero.Item[] =>
        outcome.kind === "items" ? outcome.items : [],
      (): readonly Zotero.Item[] => readNewItems() ?? [],
    )
    .then(async (late) => {
      if (late.length === 0) return;
      try {
        const trashed = await moveToTrash(late);
        options.logger?.warn(
          "searchImport: a translator lookup that missed its deadline saved " +
            "items late; they were moved to the Zotero trash",
          { saved: late.length, trashed },
        );
      } catch (error) {
        options.logger?.warn(
          "searchImport: a translator lookup that missed its deadline saved " +
            "items late, and moving them to the Zotero trash failed",
          { saved: late.length, code: codeOf(error) },
        );
      }
    });
}

/**
 * Move `items` to the Zotero trash, reversibly — never erased — and return
 * how many were moved (item 227). One `Zotero.DB.executeTransaction` around
 * `Zotero.Items.trash`, the importer's discipline (`docs/01` §5.8): DB work
 * only inside the transaction, nothing slow. An item already in the trash is
 * left as it is.
 */
export async function moveItemsToTrash(
  items: readonly Zotero.Item[],
): Promise<number> {
  const ids = [
    ...new Set(items.filter((item) => !item.deleted).map((item) => item.id)),
  ];
  if (ids.length === 0) return 0;
  await Zotero.DB.executeTransaction(async () => {
    await Zotero.Items.trash(ids);
  });
  return ids.length;
}

/**
 * `promise`, or a {@link LookupDeadline} after `ms` when `ms` is set. The
 * losing `promise` is abandoned, not stopped: it settles later, and
 * {@link trashLateSaves} deals with what it saved.
 */
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

/**
 * The recency window: what "the last 3 years" means, computed once and shared
 * by every adapter.
 *
 * **Scope.** `P1-T07` steps 3 and 4 — the window itself, the `"server"` /
 * `"client"` / `"none"` decision `docs/07` §5.3 records in provenance, and the
 * client-side filter used when a source cannot filter server-side.
 *
 * **Authority, and why this file exists rather than a constant.** The window is
 * **three calendar years — the current year and the two before it** — and
 * `docs/08-ui-ux-spec.md` §4.2 owns the computation
 * (`fromYear = currentYear − 2`, `toYear = currentYear`, evaluated when the
 * search window opens). `docs/10` FR-3 is the requirement and defers to §4.2;
 * `docs/02` §2.0 declares the same window corpus-wide and warns that the date
 * literals in its own per-source examples are *syntax* illustrations — several
 * are verbatim captures from the 2026-09-08 probe run and therefore show a
 * 36-month span. This file is written against §4.2, never against those
 * examples. It was conflict **C10** in `plan/02-phase-1-pubmed.md` §4 and it is
 * closed in favour of calendar years.
 *
 * It is **not** 1095 days. `docs/02` §3.3(a)'s `reldate=1095` is a different
 * mechanism with different semantics, and `P1-T08` chooses between them
 * explicitly for PubMed; nothing in this file may express a rolling span.
 *
 * **One span, one label.** {@link recencyWindow} returns the ISO bounds *and*
 * the years *and* the label built from them, so the number the UI shows and the
 * number the query carries cannot drift. §4.2's rule — "expose the exact
 * semantics in the UI label (`2024 – 2026`) so the user is never guessing" — is
 * only worth anything if they are the same value.
 *
 * **Layering.** `sources/` imports `core/` and `model/` only (`docs/07` §2.3).
 */

import type { PartialDate } from "../../model/canonicalWork";
import type { SourceRecord } from "../../model/sourceRecord";
import type { SourceCapabilities } from "../types";

/** U+2013 EN DASH with hair-thin spacing, exactly as `docs/08` §4.2 writes it. */
const LABEL_SEPARATOR = " – ";

/**
 * A resolved publication-date window: three calendar years by default, or
 * whatever `years` the `searchYears` preference asked for.
 *
 * Every field is derived from the same two years, so
 * `fromDate`/`toDate`/`label` can never disagree.
 */
export interface RecencyWindow {
  /** First calendar year in the window, inclusive. */
  readonly fromYear: number;
  /** Last calendar year in the window, inclusive. Normally the current year. */
  readonly toYear: number;
  /** Inclusive lower bound, `YYYY-01-01`. Feeds `SourceQuery.fromDate`. */
  readonly fromDate: string;
  /** Inclusive upper bound, `YYYY-12-31`. Feeds `SourceQuery.toDate`. */
  readonly toDate: string;
  /**
   * The span as `docs/08` §4.2 requires it to be shown: `"2024 – 2026"`.
   *
   * A pair of year numbers joined by an en dash, not translatable prose, so it
   * carries no Fluent message ID (`docs/10` FR-55 / NFR-11 are about wording;
   * there is none here). A locale that needs a different separator changes it
   * in the FTL wrapper around this value, not by recomputing the span.
   */
  readonly label: string;
}

/**
 * Resolve the recency window for a `searchYears` span and a clock.
 *
 * @param years - span in whole calendar years, ≥ 1. `3` is the shipped
 *   `searchYears` default; `docs/07` §8.5 owns the key, type, default and its
 *   1–20 range, and `P1-T03`'s pref schema is what enforces that range — this
 *   function only rejects values that are not a usable span at all, so the
 *   range lives in exactly one place.
 * @param clock - anything that can report the current time as epoch
 *   milliseconds. Typed structurally rather than as `core/clock.ts`'s `Clock`
 *   on purpose: `P1-T07` does not depend on `P1-T02`, and the real `Clock`
 *   satisfies this shape without an import, so neither a second `Clock`
 *   declaration nor a cross-card dependency is needed. Inject it — `docs/08`
 *   §4.2 requires the window be computed at window open, never hard-coded.
 * @returns the window, with the label already built
 *
 * The year is read in the **local** time zone, because §4.2's computation is
 * `new Date().getFullYear()` and the user's sense of "this year" is their own
 * calendar's, not UTC's.
 */
export function recencyWindow(
  years: number,
  clock: { now(): number },
): RecencyWindow {
  if (!Number.isInteger(years) || years < 1) {
    throw new Error(
      `[research-helper] recencyWindow(years) needs a whole number of calendar years ≥ 1; got ${String(years)}. ` +
        `docs/08 §4.2 defines the window as calendar years, so a fractional or zero span has no meaning.`,
    );
  }

  const toYear = new Date(clock.now()).getFullYear();
  // §4.2: `fromYear = toYear - 2` for the shipped span of 3. Generalised, the
  // window is inclusive of both ends, so a span of N years reaches back N − 1.
  const fromYear = toYear - (years - 1);

  return {
    fromYear,
    toYear,
    fromDate: `${String(fromYear)}-01-01`,
    toDate: `${String(toYear)}-12-31`,
    label: `${String(fromYear)}${LABEL_SEPARATOR}${String(toYear)}`,
  };
}

/**
 * Decide what `docs/07` §5.3's `SourceProvenance.dateFilterApplied` should say
 * for one source on one run.
 *
 * This is the rule `docs/07` §11.1 step 2 states as a prohibition — "if the API
 * has no server-side date filter, set `dateFilter: false` and let the shared
 * recency filter handle it; do not fake it" — written as the positive decision
 * it implies, so an adapter author cannot satisfy the capability flag by
 * pretending.
 *
 * @param capabilities - the source's own honest declaration
 * @param window - the resolved window, or `"none"` when the user chose "All
 *   years" (`docs/10` FR-3: "no date restriction is added to any source query
 *   and the provenance record states `dateFilter: none`")
 * @returns `"server"` when the source will filter, `"client"` when
 *   {@link applyClientRecencyFilter} must, `"none"` when nobody does
 */
export function resolveDateFilterMode(
  capabilities: Pick<SourceCapabilities, "dateFilter">,
  window: RecencyWindow | "none",
): "server" | "client" | "none" {
  if (window === "none") return "none";
  return capabilities.dateFilter ? "server" : "client";
}

/** What {@link applyClientRecencyFilter} did, for the caller and for provenance. */
export interface ClientRecencyFilterResult {
  /** The records inside the window, in input order. */
  readonly kept: readonly SourceRecord[];
  /** How many records were dropped because their date is outside the window. */
  readonly droppedOutOfWindow: number;
  /**
   * How many of {@link kept} had no parsed publication date at all.
   *
   * Reported rather than silently folded in: these are the records this filter
   * cannot judge (see the note on {@link applyClientRecencyFilter}), and a
   * large count is the signal that a source's mapper is losing dates.
   */
  readonly keptWithoutDate: number;
  /**
   * Always `"client"`. Assign straight into
   * `SourceProvenance.dateFilterApplied` (`docs/07` §5.3, `docs/10` FR-3: "the
   * plugin filters client-side using the parsed publication date and records
   * `dateFilterApplied: client` in provenance").
   */
  readonly dateFilterApplied: "client";
}

/**
 * Apply the recency window to records a source could not filter server-side.
 *
 * Call this exactly when {@link resolveDateFilterMode} returned `"client"`.
 *
 * **Which date.** `CanonicalWork.publishedDate` — `docs/07` §5.1 designates it
 * ("Date used for the 'last 3 years' filter. Prefer published over accepted").
 * `onlineDate` is deliberately not a fallback: §5.1 keeps it distinct for
 * preprints that were later published, so treating it as the filter date would
 * silently move a 2019 preprint into a 2024 window.
 *
 * **Partial dates are compared as spans, not as points.** A `PartialDate` of
 * `{ year: 2024, iso: "2024" }` means "some day in 2024", so it is kept if
 * *any* day in 2024 falls in the window. Comparing its `iso` string directly
 * against `fromDate` would drop every year-only record in the first year of the
 * window — and year-only is the common case for the sources that have no
 * server-side date filter in the first place.
 *
 * **Undated records are kept, and counted.** FR-3 says to filter "using the
 * parsed publication date"; a record with no parsed date cannot be shown to be
 * outside the window, and dropping it would lose results that a server-side
 * filter would have returned. The corpus does not state this case either way,
 * so the choice is recorded here and surfaced through
 * {@link ClientRecencyFilterResult.keptWithoutDate} rather than buried.
 *
 * @param records - one source's records, pre-filter
 * @param window - the window {@link recencyWindow} resolved for this run
 * @returns the kept records and the counts provenance needs
 */
export function applyClientRecencyFilter(
  records: readonly SourceRecord[],
  window: RecencyWindow,
): ClientRecencyFilterResult {
  const kept: SourceRecord[] = [];
  let droppedOutOfWindow = 0;
  let keptWithoutDate = 0;

  for (const record of records) {
    const date = record.work.publishedDate;
    if (date === undefined) {
      kept.push(record);
      keptWithoutDate += 1;
      continue;
    }
    const span = dateSpan(date);
    // Inclusive overlap between the record's possible days and the window.
    // Both sides are zero-padded `YYYY-MM-DD`, so string order is date order.
    if (span.earliest <= window.toDate && span.latest >= window.fromDate) {
      kept.push(record);
    } else {
      droppedOutOfWindow += 1;
    }
  }

  return {
    kept,
    droppedOutOfWindow,
    keptWithoutDate,
    dateFilterApplied: "client",
  };
}

/** Zero-pad to two digits, for `YYYY-MM-DD` string comparison. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Last day of a 1-based month, leap years included. */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of month+1 is the last day of `month`; UTC keeps it time-zone-free.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The inclusive range of real days a {@link PartialDate} could denote.
 *
 * A month or day outside its valid range is treated as absent rather than
 * trusted — `PartialDate` is built by source mappers from upstream strings, and
 * a `month: 0` from a mapper should widen the span to the whole year, not
 * produce a nonsense bound that drops the record.
 */
function dateSpan(date: PartialDate): { earliest: string; latest: string } {
  const year = String(date.year);
  const month = date.month;
  if (
    month === undefined ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { earliest: `${year}-01-01`, latest: `${year}-12-31` };
  }

  const day = date.day;
  const last = lastDayOfMonth(date.year, month);
  if (day === undefined || !Number.isInteger(day) || day < 1 || day > last) {
    return {
      earliest: `${year}-${pad2(month)}-01`,
      latest: `${year}-${pad2(month)}-${pad2(last)}`,
    };
  }

  const exact = `${year}-${pad2(month)}-${pad2(day)}`;
  return { earliest: exact, latest: exact };
}

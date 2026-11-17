/**
 * Every date, number, dollar amount, duration and size the plugin's UI shows,
 * formatted with `Intl` in the locale the caller passes (`P7-T03`; `docs/10`
 * NFR-11, `docs/08` §10.3: "the caller formats with `Intl`"). One place, so a
 * dialog, a pane and a view model cannot format the same value two ways.
 *
 * **Callers.** `src/ui/dialogs/costConfirmDialog.ts` (every amount, count,
 * list, duration, size and price-table date it places in a message);
 * `src/ui/viewModels/reportViewModel.ts` and
 * `src/ui/viewModels/searchImportViewModel.ts` ({@link formatUsd});
 * `src/ui/panes/summarySection.ts` ({@link formatDateTime}). Each passes
 * `Zotero.locale` as its host gives it. Nothing is constructed: every export
 * is a pure function.
 *
 * **Not here, on purpose** (coordinator, 2026-11-17, under `plan/00` §6
 * item 313): `addon/content/preferences.js` keeps its own `formatTime`,
 * `formatDate` and `formatPrice`, because a chrome script loaded by the
 * preferences pane cannot import the plugin's bundle; `format.test.ts` pins
 * them as the only other `Intl` calls in the tree. A year is never formatted:
 * it is written as digits so no locale groups it (`searchDialog.ts`'s
 * `SearchWindowRecord`).
 *
 * The functions were `costConfirmDialog.ts`'s until 2026-11-17 and keep its
 * output byte for byte; `formatCount` is now {@link formatNumber} and
 * `formatMegabytes` is {@link formatBytes}.
 */

/**
 * US dollars for display. A positive amount under one cent keeps four
 * decimals, so a $0.004 call does not read "$0.00".
 */
export function formatUsd(usd: number, locale: string): string {
  const small = usd > 0 && usd < 0.01;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: small ? 4 : 2,
  }).format(usd);
}

/** A count (tokens, characters, papers), grouped for the locale, no decimals. */
export function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

/** Names joined as a list for the locale ("a, b, and c"); never translated. */
export function formatList(names: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(names);
}

/** A duration in whole minutes, at least one, for the locale ("10 minutes"). */
export function formatMinutes(seconds: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "minute",
    unitDisplay: "long",
    maximumFractionDigits: 0,
  }).format(Math.max(1, Math.round(seconds / 60)));
}

/** A file size in decimal megabytes, one decimal ("28.8 MB"). */
export function formatBytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / 1_000_000);
}

/** A calendar date, in UTC (a price table is dated, not timed). */
export function formatDate(epochMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(epochMs);
}

/**
 * A moment in the user's own time zone, date and time ("Nov 17, 2026, 9:05
 * PM"): when a summary was made. A locale `Intl` refuses falls back to the
 * ISO form rather than throwing into a paint.
 */
export function formatDateTime(epochMs: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString();
  }
}

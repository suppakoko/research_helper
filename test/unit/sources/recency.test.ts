import { describe, expect, it } from "vitest";

import type { PartialDate } from "../../../src/model/canonicalWork";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import {
  applyClientRecencyFilter,
  recencyWindow,
  resolveDateFilterMode,
} from "../../../src/sources/shared/recency";

/**
 * `P1-T07`. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * The window is asserted against docs/08 §4.2's definition — three *calendar*
 * years — and never against docs/02's per-source date literals, several of which
 * are 2026-09-08 probe captures showing a 36-month span (docs/02 §2.0).
 */

/**
 * A clock reading a fixed local date. Built with the local-time `Date`
 * constructor rather than `Date.UTC`, because §4.2's computation is
 * `new Date().getFullYear()` — local — and a UTC instant near a year boundary
 * would make this test's expectation depend on the runner's time zone.
 */
function clockAt(year: number, month1: number, day: number): { now(): number } {
  const at = new Date(year, month1 - 1, day, 12, 0, 0).getTime();
  return { now: () => at };
}

/** The en dash docs/08 §4.2 writes; escaped so the character is unambiguous. */
const EN_DASH = "–";

/** A minimal `SourceRecord`, optionally dated. */
function record(nativeId: string, publishedDate?: PartialDate): SourceRecord {
  return {
    id: `pubmed:${nativeId}`,
    sourceId: "pubmed",
    nativeId,
    work: {
      ids: {},
      type: "journal-article",
      title: `Paper ${nativeId}`,
      authors: [],
      ...(publishedDate !== undefined && { publishedDate }),
    },
    retrievedAtEpochMs: 0,
    missingFields: [],
  };
}

describe("recencyWindow", () => {
  it("resolves the shipped 3-calendar-year window at 2026-09-09", () => {
    const window = recencyWindow(3, clockAt(2026, 9, 9));

    expect(window.fromYear).toBe(2024);
    expect(window.toYear).toBe(2026);
    expect(window.fromDate).toBe("2024-01-01");
    expect(window.toDate).toBe("2026-12-31");
    expect(window.label).toBe(`2024 ${EN_DASH} 2026`);
  });

  it("is calendar-year, not a rolling 36 months, on the same date", () => {
    // A rolling window from 2026-09-09 would start 2023-09-09. Conflict C10
    // (plan/02 §4) was settled against exactly that reading.
    expect(recencyWindow(3, clockAt(2026, 9, 9)).fromDate).not.toBe(
      "2023-09-09",
    );
  });

  it("keeps the label and the ISO bounds derived from the same two years", () => {
    const window = recencyWindow(5, clockAt(2030, 1, 1));

    expect(window.fromDate.startsWith(String(window.fromYear))).toBe(true);
    expect(window.toDate.startsWith(String(window.toYear))).toBe(true);
    expect(window.label).toBe(`2026 ${EN_DASH} 2030`);
  });

  it("treats a span of 1 as the current calendar year alone", () => {
    const window = recencyWindow(1, clockAt(2026, 12, 31));

    expect(window.fromDate).toBe("2026-01-01");
    expect(window.toDate).toBe("2026-12-31");
  });

  it("reads the year from the injected clock, never from the real one", () => {
    expect(recencyWindow(3, clockAt(1999, 6, 15)).label).toBe(
      `1997 ${EN_DASH} 1999`,
    );
  });

  it.each([0, -1, 2.5, Number.NaN])("rejects a span of %s", (years) => {
    expect(() => recencyWindow(years, clockAt(2026, 9, 9))).toThrow(
      /whole number of calendar years/,
    );
  });
});

describe("resolveDateFilterMode", () => {
  const window = recencyWindow(3, clockAt(2026, 9, 9));

  it('reports "server" when the source filters server-side', () => {
    expect(resolveDateFilterMode({ dateFilter: true }, window)).toBe("server");
  });

  it('reports "client" when the source declares dateFilter: false', () => {
    expect(resolveDateFilterMode({ dateFilter: false }, window)).toBe("client");
  });

  it('reports "none" for "All years", whatever the capability says', () => {
    expect(resolveDateFilterMode({ dateFilter: true }, "none")).toBe("none");
    expect(resolveDateFilterMode({ dateFilter: false }, "none")).toBe("none");
  });
});

describe("applyClientRecencyFilter", () => {
  const window = recencyWindow(3, clockAt(2026, 9, 9)); // 2024-01-01 … 2026-12-31

  it('always records dateFilterApplied: "client" for provenance', () => {
    const result = applyClientRecencyFilter([], window);

    expect(result.dateFilterApplied).toBe("client");
    expect(result.kept).toEqual([]);
    expect(result.droppedOutOfWindow).toBe(0);
  });

  it("keeps a year-only date in the first year of the window", () => {
    // The case a naive `iso >= fromDate` comparison gets wrong: "2024" sorts
    // before "2024-01-01".
    const inWindow = record("1", { year: 2024, iso: "2024" });

    const result = applyClientRecencyFilter([inWindow], window);

    expect(result.kept).toEqual([inWindow]);
    expect(result.droppedOutOfWindow).toBe(0);
  });

  it("drops dates on either side of the window and keeps the rest in order", () => {
    const tooOld = record("old", {
      year: 2023,
      month: 12,
      day: 31,
      iso: "2023-12-31",
    });
    const first = record("first", {
      year: 2024,
      month: 1,
      day: 1,
      iso: "2024-01-01",
    });
    const last = record("last", {
      year: 2026,
      month: 12,
      day: 31,
      iso: "2026-12-31",
    });
    const tooNew = record("new", {
      year: 2027,
      month: 1,
      day: 1,
      iso: "2027-01-01",
    });

    const result = applyClientRecencyFilter(
      [tooOld, first, last, tooNew],
      window,
    );

    expect(result.kept.map((r) => r.nativeId)).toEqual(["first", "last"]);
    expect(result.droppedOutOfWindow).toBe(2);
    expect(result.keptWithoutDate).toBe(0);
  });

  it("keeps a month-precision date whose month straddles the boundary", () => {
    // December 2023 cannot overlap 2024; January 2024 can.
    const dec2023 = record("dec", { year: 2023, month: 12, iso: "2023-12" });
    const jan2024 = record("jan", { year: 2024, month: 1, iso: "2024-01" });

    const result = applyClientRecencyFilter([dec2023, jan2024], window);

    expect(result.kept.map((r) => r.nativeId)).toEqual(["jan"]);
  });

  it("keeps undated records and counts them separately", () => {
    const undated = record("undated");
    const dated = record("dated", { year: 2025, iso: "2025" });

    const result = applyClientRecencyFilter([undated, dated], window);

    expect(result.kept).toHaveLength(2);
    expect(result.keptWithoutDate).toBe(1);
    expect(result.droppedOutOfWindow).toBe(0);
  });

  it("widens an out-of-range month or day to the coarser span", () => {
    // A mapper that emitted month: 0 must not have its record dropped on the
    // strength of a bound the source never asserted.
    const badMonth = record("badMonth", { year: 2025, month: 0, iso: "2025" });
    const badDay = record("badDay", {
      year: 2025,
      month: 2,
      day: 31,
      iso: "2025-02",
    });

    const result = applyClientRecencyFilter([badMonth, badDay], window);

    expect(result.kept).toHaveLength(2);
    expect(result.droppedOutOfWindow).toBe(0);
  });

  it("handles February in a leap year at day precision", () => {
    const leap = record("leap", {
      year: 2024,
      month: 2,
      day: 29,
      iso: "2024-02-29",
    });

    expect(applyClientRecencyFilter([leap], window).kept).toHaveLength(1);
  });

  it("ignores onlineDate — publishedDate is the filter date (docs/07 §5.1)", () => {
    const preprintThenPublished: SourceRecord = {
      ...record("pp", { year: 2019, iso: "2019" }),
      work: {
        ...record("pp", { year: 2019, iso: "2019" }).work,
        onlineDate: { year: 2025, iso: "2025" },
      },
    };

    const result = applyClientRecencyFilter([preprintThenPublished], window);

    expect(result.kept).toEqual([]);
    expect(result.droppedOutOfWindow).toBe(1);
  });
});

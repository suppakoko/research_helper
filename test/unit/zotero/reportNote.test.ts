/**
 * `P4-T14` — the trend report's note writer, at layer 1 (`docs/06` §14.2 and
 * its note of 2026-10-30; §16 items 6 and 7).
 *
 * Plain Node: every Zotero call `writeReportNote` makes is injected, so the
 * checks that decide whether anything is written — read-only and group
 * libraries, the group confirmation, a vanished collection — are asserted on
 * the argument check alone, and no test writes into a group library (the
 * card's **Do NOT**). The real write, into a personal library, is
 * `test/integration/zotero/reportNote.spec.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  datedReportTitle,
  isGeneratedTag,
  NOTE_TITLE_MAX_LENGTH,
  reportMarkerComment,
  reportNoteHtml,
  TREND_REPORT_TAG,
  writeReportNote,
  type ReportLibrary,
  type ReportNoteItem,
  type ReportNoteSubject,
  type WriteReportNoteDeps,
} from "../../../src/zotero/notes";

const AT = Date.UTC(2026, 9, 30, 5, 6, 7);

function subject(
  overrides: Partial<ReportNoteSubject> = {},
): ReportNoteSubject {
  return {
    id: "rpt-20261030-a1",
    libraryID: 1,
    collectionKey: "COLL2345",
    title: datedReportTitle("Research Trends: CRISPR delivery", AT),
    language: "en",
    generatedAtEpochMs: AT,
    ...overrides,
  };
}

const RENDERED =
  '<div data-citation-items="%5B%5D" data-schema-version="9">' +
  "<h1>Research Trends: CRISPR delivery</h1><p>Body.</p></div>";

interface Recorded {
  readonly calls: string[];
  readonly notes: ReportNoteItem[];
}

/** A note double that records the order of every call made on it. */
function noteFactory(): { create: () => ReportNoteItem; recorded: Recorded } {
  const recorded: Recorded = { calls: [], notes: [] };
  let next = 0;
  const create = (): ReportNoteItem => {
    next += 1;
    const key = `NOTE000${String(next)}`;
    let libraryID = 0;
    const note: ReportNoteItem = {
      get libraryID() {
        return libraryID;
      },
      set libraryID(value: number) {
        recorded.calls.push(`libraryID=${String(value)}`);
        libraryID = value;
      },
      key,
      setNote(content) {
        recorded.calls.push(`setNote:${content}`);
        return true;
      },
      setCollections(keys) {
        recorded.calls.push(`setCollections:${keys.join(",")}`);
      },
      addTag(name, type) {
        recorded.calls.push(`addTag:${name}:${String(type)}`);
        return true;
      },
      saveTx(options) {
        recorded.calls.push(`saveTx:${JSON.stringify(options)}`);
        return Promise.resolve(1);
      },
    };
    recorded.notes.push(note);
    return note;
  };
  return { create, recorded };
}

function deps(
  library: ReportLibrary | undefined,
  overrides: Partial<WriteReportNoteDeps> = {},
): { deps: WriteReportNoteDeps; recorded: Recorded } {
  const { create, recorded } = noteFactory();
  return {
    recorded,
    deps: {
      createNote: create,
      library: () => library,
      collectionExists: () => true,
      autoSyncDelay: () => 15,
      ...overrides,
    },
  };
}

const MY_LIBRARY: ReportLibrary = {
  editable: true,
  kind: "user",
  name: "My Library",
};
const GROUP: ReportLibrary = { editable: true, kind: "group", name: "Lab A" };

describe("P4-T14 — datedReportTitle", () => {
  it("is the heading, then the UTC date and time to the second", () => {
    expect(datedReportTitle("Research Trends: X", AT)).toBe(
      "Research Trends: X (2026-10-30 05:06:07 UTC)",
    );
  });

  it("gives two runs a second apart two titles", () => {
    expect(datedReportTitle("Research Trends: X", AT)).not.toBe(
      datedReportTitle("Research Trends: X", AT + 1000),
    );
  });

  it("cuts a long heading by code point, never the date, to Zotero's 120", () => {
    // "x" puts the cut on an odd UTF-16 offset, inside a pair if cut by unit.
    const heading = `Research Trends: x${"😀".repeat(80)}`;
    const title = datedReportTitle(heading, AT);
    expect(title.length).toBeLessThanOrEqual(NOTE_TITLE_MAX_LENGTH);
    expect(title.endsWith("… (2026-10-30 05:06:07 UTC)")).toBe(true);
    // No half of a surrogate pair is left behind by the cut.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(title)).toBe(false);
    expect(title).not.toMatch(/�/u);
    const exact = "x".repeat(NOTE_TITLE_MAX_LENGTH - 26);
    expect(datedReportTitle(exact, AT)).toHaveLength(NOTE_TITLE_MAX_LENGTH);
    expect(datedReportTitle(`${exact}y`, AT)).toHaveLength(
      NOTE_TITLE_MAX_LENGTH,
    );
  });

  it("collapses whitespace in the heading, and refuses a time that is not a date", () => {
    expect(datedReportTitle("  Research\n Trends:  X ", AT)).toBe(
      "Research Trends: X (2026-10-30 05:06:07 UTC)",
    );
    expect(() => datedReportTitle("X", Number.NaN)).toThrow(RangeError);
  });
});

describe("P4-T14 — reportNoteHtml puts the dated title first, then the marker", () => {
  it("replaces the title block's h1 inside the citation wrapper", () => {
    const html = reportNoteHtml(RENDERED, subject());
    expect(html).toBe(
      '<div data-citation-items="%5B%5D" data-schema-version="9">' +
        "<h1>Research Trends: CRISPR delivery (2026-10-30 05:06:07 UTC)</h1>" +
        "<!-- rh:report v=1 id=rpt-20261030-a1 lang=en generatedAt=2026-10-30T05:06:07.000Z -->" +
        "<p>Body.</p></div>",
    );
    expect(html.match(/<h1>/gu)).toHaveLength(1);
  });

  it("inserts the title when the report opens with another heading, keeping it", () => {
    const html = reportNoteHtml(
      '<div data-schema-version="9"><h1>Something else</h1></div>',
      subject(),
    );
    expect(html).toContain(
      "UTC)</h1><!-- rh:report v=1 id=rpt-20261030-a1 lang=en generatedAt=2026-10-30T05:06:07.000Z --><h1>Something else</h1>",
    );
  });

  it("prepends the title to HTML with no wrapper, and escapes it", () => {
    const html = reportNoteHtml(
      "<p>Body.</p>",
      subject({ title: "A <b> & B (2026-10-30 05:06:07 UTC)", language: "ko" }),
    );
    expect(html.startsWith("<h1>A &lt;b&gt; &amp; B (2026")).toBe(true);
    expect(html).toContain("lang=ko");
    expect(html.endsWith("<p>Body.</p>")).toBe(true);
  });

  it("matches a title-block heading holding escaped characters", () => {
    const html = reportNoteHtml(
      "<h1>Research Trends: A &amp; B</h1><p>x</p>",
      subject({ title: "Research Trends: A & B (2026-10-30 05:06:07 UTC)" }),
    );
    expect(html.match(/<h1>/gu)).toHaveLength(1);
  });

  it("writes the marker with the id, language and time only", () => {
    expect(reportMarkerComment(subject())).toBe(
      "<!-- rh:report v=1 id=rpt-20261030-a1 lang=en generatedAt=2026-10-30T05:06:07.000Z -->",
    );
  });
});

describe("P4-T14 — writeReportNote", () => {
  it("writes a standalone note: libraryID first, the HTML, the collection, the tag, one saveTx with the sync debounce", async () => {
    const { deps: d, recorded } = deps(MY_LIBRARY);
    const outcome = await writeReportNote(
      { report: subject(), html: RENDERED },
      d,
    );
    expect(outcome).toStrictEqual({ kind: "written", noteKey: "NOTE0001" });
    const calls = recorded.calls.map((call) =>
      call.startsWith("setNote:") ? "setNote" : call,
    );
    expect(calls).toStrictEqual([
      "libraryID=1",
      "setNote",
      "setCollections:COLL2345",
      `addTag:${TREND_REPORT_TAG}:1`,
      'saveTx:{"notifierData":{"autoSyncDelay":15}}',
    ]);
    expect(recorded.calls[1]).toBe(
      `setNote:${reportNoteHtml(RENDERED, subject())}`,
    );
    expect(TREND_REPORT_TAG).toBe("research_helper/trend-report");
  });

  it("writes a new note on every call: two runs leave two notes with distinct dated titles", async () => {
    const { deps: d, recorded } = deps(MY_LIBRARY);
    const first = await writeReportNote(
      { report: subject(), html: RENDERED },
      d,
    );
    const second = await writeReportNote(
      {
        report: subject({
          id: "rpt-20261030-b2",
          generatedAtEpochMs: AT + 60_000,
          title: datedReportTitle(
            "Research Trends: CRISPR delivery",
            AT + 60_000,
          ),
        }),
        html: RENDERED,
      },
      d,
    );
    expect(first).toStrictEqual({ kind: "written", noteKey: "NOTE0001" });
    expect(second).toStrictEqual({ kind: "written", noteKey: "NOTE0002" });
    expect(recorded.notes).toHaveLength(2);
    const titles = recorded.calls
      .filter((call) => call.startsWith("setNote:"))
      .map((call) => /<h1>([^<]*)<\/h1>/u.exec(call)?.[1]);
    expect(titles).toStrictEqual([
      "Research Trends: CRISPR delivery (2026-10-30 05:06:07 UTC)",
      "Research Trends: CRISPR delivery (2026-10-30 05:07:07 UTC)",
    ]);
  });

  it('returns "export only" for a read-only, unknown or feed library, and writes nothing', async () => {
    for (const library of [
      { ...MY_LIBRARY, editable: false },
      { ...GROUP, editable: false },
      undefined,
      { editable: true, kind: "other", name: "A feed" } as const,
    ]) {
      const { deps: d, recorded } = deps(library);
      expect(
        await writeReportNote({ report: subject(), html: RENDERED }, d),
      ).toStrictEqual({ kind: "export-only" });
      expect(recorded.notes).toHaveLength(0);
    }
  });

  it("refuses a group library without the confirmation answer, naming the group, and writes nothing", async () => {
    const { deps: d, recorded } = deps(GROUP);
    expect(
      await writeReportNote({ report: subject(), html: RENDERED }, d),
    ).toStrictEqual({
      kind: "group-confirmation-required",
      libraryID: 1,
      groupName: "Lab A",
    });
    expect(recorded.notes).toHaveLength(0);
  });

  it("refuses an answer that named another group or library, or was not a yes", async () => {
    for (const answer of [
      { confirmed: true, libraryID: 2, groupName: "Lab A" },
      { confirmed: true, libraryID: 1, groupName: "Lab B" },
      { confirmed: false, libraryID: 1, groupName: "Lab A" },
    ]) {
      const { deps: d, recorded } = deps(GROUP);
      const outcome = await writeReportNote(
        {
          report: subject(),
          html: RENDERED,
          groupConfirmation: answer as never,
        },
        d,
      );
      expect(outcome.kind).toBe("group-confirmation-required");
      expect(recorded.notes).toHaveLength(0);
    }
  });

  it("writes into a group library once the answer names it (argument check only)", async () => {
    const { deps: d, recorded } = deps(GROUP);
    const outcome = await writeReportNote(
      {
        report: subject(),
        html: RENDERED,
        groupConfirmation: {
          confirmed: true,
          libraryID: 1,
          groupName: "Lab A",
        },
      },
      d,
    );
    expect(outcome).toStrictEqual({ kind: "written", noteKey: "NOTE0001" });
    expect(recorded.notes).toHaveLength(1);
  });

  it("writes nothing when the collection is gone", async () => {
    const { deps: d, recorded } = deps(MY_LIBRARY, {
      collectionExists: () => false,
    });
    expect(
      await writeReportNote({ report: subject(), html: RENDERED }, d),
    ).toStrictEqual({ kind: "no-collection" });
    expect(recorded.notes).toHaveLength(0);
  });

  it("refuses a report id the store would refuse, before any check or write", async () => {
    const { deps: d, recorded } = deps(MY_LIBRARY);
    await expect(
      writeReportNote({ report: subject({ id: "a--b" }), html: RENDERED }, d),
    ).rejects.toThrow(RangeError);
    expect(recorded.notes).toHaveLength(0);
  });

  it("tags in the namespace FR-20's removal command matches (step 5)", () => {
    expect(isGeneratedTag(TREND_REPORT_TAG)).toBe(true);
  });
});

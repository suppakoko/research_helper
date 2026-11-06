/**
 * The summarize library's venue (`plan/00` §6 items 345(d) and 358(b)).
 *
 * `readItemsForSummary` in `src/zotero/notes.ts` read `publicationTitle` by its
 * own name, so a conference paper, a book section and a webpage had no venue.
 * It now takes it from `snapshotZoteroItem`, which reads it base-mapped
 * (`docs/07` §6.6's notes of 2026-11-05). The stub answers a type's own field
 * only when the third argument of `getField` is `true`, as Zotero 10.0.3 does
 * (`test/integration/zotero/relatedLibrary.spec.ts`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createZoteroSummarizeLibrary } from "../../../src/bootstrap/registerPipelines";
import { screenItems } from "../../../src/pipeline/summarize/screen";
import { fromZoteroItem } from "../../../src/zotero/itemMapper";
import { dateTextOf, readItemsForSummary } from "../../../src/zotero/notes";

interface StubSpec {
  readonly itemType: string;
  /** Answered only when `getField`'s third argument is `true`. */
  readonly mapped?: Readonly<Record<string, string>>;
  /** Answered whatever the third argument. */
  readonly plain?: Readonly<Record<string, string>>;
  readonly lastName?: string;
}

const LIBRARY = 1;

/** Install a Zotero holding these items under keys `K0`, `K1`, … */
function stubLibrary(specs: readonly StubSpec[]): {
  readonly items: Zotero.Item[];
  readonly asked: string[];
} {
  const asked: string[] = [];
  const items = specs.map((spec, at) => {
    const answer = (name: string, mapped?: boolean): string =>
      (mapped === true ? spec.mapped?.[name] : undefined) ??
      spec.plain?.[name] ??
      "";
    return {
      id: 100 + at,
      key: `K${String(at)}`,
      libraryID: LIBRARY,
      itemType: spec.itemType,
      itemTypeID: at,
      deleted: false,
      dateAdded: "2026-01-01 00:00:00",
      dateModified: "2026-01-02 00:00:00",
      isRegularItem: () => true,
      getField: (name: string, _unformatted?: boolean, mapped?: boolean) => {
        if (name === "publicationTitle") {
          asked.push(`publicationTitle ${String(mapped === true)}`);
        }
        return answer(name, mapped);
      },
      getCreatorsJSON: () =>
        spec.lastName === undefined
          ? []
          : [
              {
                creatorType: "author",
                firstName: "Ada",
                lastName: spec.lastName,
              },
            ],
      getTags: () => [],
      getAttachments: () => [],
    } as unknown as Zotero.Item;
  });
  vi.stubGlobal("Zotero", {
    debug: () => undefined,
    ItemTypes: {
      getName: (id: number) => specs[id]?.itemType ?? "",
    },
    Items: {
      getByLibraryAndKey: (_library: number, key: string) =>
        items.find((item) => item.key === key) ?? false,
    },
    Libraries: { get: () => ({ editable: true }) },
    Retractions: { isRetracted: () => false },
  });
  return { items, asked };
}

const keys = (count: number): string[] =>
  Array.from({ length: count }, (_, at) => `K${String(at)}`);

describe("the summarize library's venue (items 345(d), 358(b))", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["conferencePaper", "Proceedings of CVPR"],
    ["bookSection", "A handbook"],
    ["webpage", "A site"],
  ])("reads a %s's container as its venue", async (itemType, name) => {
    stubLibrary([
      {
        itemType,
        plain: { title: "A title" },
        mapped: { publicationTitle: name },
      },
    ]);
    const read = await readItemsForSummary(LIBRARY, ["K0"]);
    expect(read.items[0]?.publicationTitle).toBe(name);
  });

  it("asks for publicationTitle base-mapped, once an item", async () => {
    const { asked } = stubLibrary([{ itemType: "conferencePaper" }]);
    await readItemsForSummary(LIBRARY, ["K0"]);
    expect(asked).toStrictEqual(["publicationTitle true"]);
  });

  it("keeps a journal article's venue and a preprint's empty one", async () => {
    stubLibrary([
      {
        itemType: "journalArticle",
        plain: { title: "A", publicationTitle: "Nature" },
      },
      // A preprint's `repository` is base-mapped onto `publisher`, never onto
      // `publicationTitle`, so its venue stays "" as it was.
      {
        itemType: "preprint",
        plain: { title: "B", repository: "bioRxiv" },
        mapped: { publisher: "bioRxiv" },
      },
      { itemType: "thesis", plain: { title: "C", university: "KAIST" } },
    ]);
    const read = await readItemsForSummary(LIBRARY, keys(3));
    expect(read.items.map((item) => item.publicationTitle)).toStrictEqual([
      "Nature",
      "",
      "",
    ]);
  });

  it("leaves the work key as fromZoteroItem derives it", async () => {
    const { items } = stubLibrary([
      {
        itemType: "conferencePaper",
        mapped: { publicationTitle: "Proceedings" },
        plain: { title: "A title", DOI: "10.1000/rh.1" },
      },
      {
        itemType: "conferencePaper",
        mapped: { publicationTitle: "Proceedings" },
        plain: { title: "No identifier", date: "2020-00-00 2020" },
        lastName: "Fixture",
      },
    ]);
    const read = await readItemsForSummary(LIBRARY, keys(2));
    expect(read.items.map((item) => item.workKey)).toStrictEqual(
      items.map((item) => fromZoteroItem(item).workKey),
    );
    expect(read.items[0]?.workKey).toBe("doi:10.1000/rh.1");
  });

  it("hands the venue to the prompt's metadata and to screening", async () => {
    stubLibrary([
      {
        itemType: "conferencePaper",
        plain: { title: "A title" },
        mapped: { publicationTitle: "Proceedings of CVPR" },
      },
    ]);
    const library = createZoteroSummarizeLibrary();
    const loaded = await library.loadItems(LIBRARY, ["K0"]);
    expect(loaded.items[0]?.metadata.venue).toBe("Proceedings of CVPR");
    expect(loaded.items[0]?.screen.containerTitle).toBe("Proceedings of CVPR");
  });

  it("keeps a conference paper and its journal version a year later, neither as the other's duplicate", async () => {
    // `docs/02` §11.3.3 guard 3: same title, another year, another venue is a
    // conference paper later extended, so it is linked, not merged. With no
    // venue read for the conference paper the guard could not apply.
    const title = "Deep residual learning for image recognition at scale";
    stubLibrary([
      {
        itemType: "conferencePaper",
        mapped: { publicationTitle: "Proceedings of CVPR" },
        plain: { title, date: "2016-00-00 2016" },
        lastName: "He",
      },
      {
        itemType: "journalArticle",
        plain: {
          title,
          publicationTitle: "IEEE Transactions on Pattern Analysis",
          date: "2017-00-00 2017",
        },
        lastName: "He",
      },
    ]);
    const library = createZoteroSummarizeLibrary();
    const loaded = await library.loadItems(LIBRARY, keys(2));
    const report = screenItems(
      loaded.items.map((item) => item.screen),
      {
        retractionPolicy: "include",
        nonEnglishPolicy: "summarize_in_source_language",
        dedupe: true,
      },
    );
    expect(report.decisions.map((d) => d.duplicateOf)).toStrictEqual([
      undefined,
      undefined,
    ]);
  });
  // Extended by the coordinator on 2026-11-06 (item 358(b)): the same reader's
  // `title` and `date`, read through the same base-mapped snapshot.
  it.each([
    ["case", "Brown v. Board of Education"],
    ["email", "Re: the draft"],
    ["statute", "Copyright Act"],
  ])("reads a %s's own title field as its title", async (itemType, name) => {
    stubLibrary([{ itemType, mapped: { title: name } }]);
    const read = await readItemsForSummary(LIBRARY, ["K0"]);
    expect(read.items[0]?.title).toBe(name);
  });

  it.each([
    ["patent", "2016-05-04 2016-05-04", "2016-05-04", 2016],
    ["case", "2019-03-03 March 3, 2019", "March 3, 2019", 2019],
    ["statute", "2017-00-00 2017", "2017", 2017],
  ])(
    "reads a %s's own date field as its date, and the year from it",
    async (itemType, multipart, text, year) => {
      stubLibrary([
        { itemType, plain: { title: "A title" }, mapped: { date: multipart } },
      ]);
      const read = await readItemsForSummary(LIBRARY, ["K0"]);
      expect(read.items[0]?.date).toBe(text);
      const loaded = await createZoteroSummarizeLibrary().loadItems(LIBRARY, [
        "K0",
      ]);
      expect(loaded.items[0]?.metadata.year).toBe(year);
      expect(loaded.items[0]?.screen.year).toBe(year);
    },
  );

  it("hands a statute's title to the prompt's metadata and to screening", async () => {
    stubLibrary([{ itemType: "statute", mapped: { title: "Copyright Act" } }]);
    const loaded = await createZoteroSummarizeLibrary().loadItems(LIBRARY, [
      "K0",
    ]);
    expect(loaded.items[0]?.metadata.title).toBe("Copyright Act");
    expect(loaded.items[0]?.screen.title).toBe("Copyright Act");
  });
});

describe("dateTextOf, as Zotero 10.0.3's multipartToStr (item 358(b))", () => {
  it.each([
    ["2019-03-03 March 3, 2019", "March 3, 2019"],
    ["2017-00-00 2017", "2017"],
    ["0000-00-00 c. 1999", "c. 1999"],
    ["", ""],
    ["2017", "2017"],
    // Not multipart: a month of 13, and a SQL date-time, are returned whole.
    ["2017-13-01 x", "2017-13-01 x"],
    ["2017-01-01 10:00:00", "2017-01-01 10:00:00"],
  ])("reads %j as %j", (multipart, text) => {
    expect(dateTextOf(multipart)).toBe(text);
  });
});

/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it writes its own fixture items and reads Zotero's preferences and URIs to check the module against the platform itself. */
/**
 * `P4-T11`: the report's bibliography and citation nodes, made by Zotero
 * (`src/zotero/bibliography.ts`). The measurement this card was for is
 * recorded in `docs/01` §5.11; this spec is what keeps it true.
 *
 * - **The entry point.** `Zotero.Styles.get(id).getCiteProc(locale, format)`
 *   formats three local fixture items in two styles (APA and IEEE) into
 *   different strings, in the order the report asks for (`[n]`), with the
 *   style's own numbers removed; every style Zotero bundles is tried too.
 * - **The locale is the caller's.** The same style in `en-US` and `ko-KR`
 *   gives different text, and Zotero's default would be the UI's locale —
 *   `ko-KR` on the machine this suite runs on — so the module never relies
 *   on the default. The CSL locale is passed explicitly and the UI locale is
 *   not pinned: nothing here asserts text that Zotero's UI language decides,
 *   except where that dependence is the measurement (logged, not asserted).
 * - **Citation nodes** parse back to the same item URIs, those URIs resolve to
 *   the same items, and a note saved with them reads back byte for byte.
 *
 * No network, no LLM (`docs/13` §2.3). Every fixture carries
 * {@link FIXTURE_TAG} and is erased in `after()`.
 */

import {
  entriesInOrder,
  type FormattedBibliography,
  noteWrapperOpenTag,
  parseCitationUris,
  stripStyleNumbers,
  zoteroBibliographyPort,
} from "../../../src/zotero/bibliography";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void> | void): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P4-T11]";
const FIXTURE_TAG = "rh-p4t11-fixture";

const APA = "http://www.zotero.org/styles/apa";
const IEEE = "http://www.zotero.org/styles/ieee";
const NATURE = "http://www.zotero.org/styles/nature";

/** A label a numeric style puts first: `[1]`, `(1)`, `1.`, `1)`. */
const LEADING_LABEL = /^(\[\d+\]|\(\d+\)|\d+\.|\d+\))\s/u;

interface Fixture {
  readonly title: string;
  readonly creators: readonly (readonly [string, string])[];
  readonly year: string;
  readonly journal: string;
  readonly volume: string;
  readonly pages: string;
  readonly doi: string;
}

const FIXTURES = {
  kim: {
    title: "Deep learning for protein structure prediction",
    creators: [
      ["Kim", "Minjun"],
      ["Lee", "Seoyeon"],
      ["Park", "Jiho"],
    ],
    year: "2024",
    journal: "Nature Methods",
    volume: "21",
    pages: "100-110",
    doi: "10.1000/RH.P4T11.A",
  },
  smith: {
    title: "A survey of graph neural networks",
    creators: [["Smith", "Anna"]],
    year: "2022",
    journal: "Journal of Machine Learning Research",
    volume: "23",
    pages: "1-40",
    doi: "10.1000/rh.p4t11.b",
  },
  hong: {
    title: "단백질 구조 예측의 최근 동향",
    creators: [
      ["홍", "길동"],
      ["Brown", "Carl"],
    ],
    year: "2023",
    journal: "한국생물정보학회지",
    volume: "5",
    pages: "12-20",
    doi: "10.1000/rh.p4t11.c",
  },
  markup: {
    title: "A <b>bold</b> & risky claim",
    creators: [["O'<Brien> & Sons", "Pat"]],
    year: "2021",
    journal: "Journal of Escaping",
    volume: "1",
    pages: "1-2",
    doi: "10.1000/rh.p4t11.d",
  },
} as const satisfies Record<string, Fixture>;

const createdItemIDs: number[] = [];
const libraryID = (): number => Zotero.Libraries.userLibraryID;

async function createFixture(fixture: Fixture): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = libraryID();
  item.setField("title", fixture.title);
  item.setCreators(
    fixture.creators.map(([lastName, firstName]) => ({
      lastName,
      firstName,
      creatorType: "author",
    })),
  );
  item.setField("date", fixture.year);
  item.setField("publicationTitle", fixture.journal);
  item.setField("volume", fixture.volume);
  item.setField("pages", fixture.pages);
  item.setField("DOI", fixture.doi);
  item.addTag(FIXTURE_TAG, 1);
  await item.saveTx();
  createdItemIDs.push(item.id);
  return item;
}

function log(line: string): void {
  debug(`${LOG_PREFIX} ${line}`);
}

describe("Bibliography and citation nodes through Zotero (P4-T11)", function () {
  const keys: Record<keyof typeof FIXTURES, string> = {
    kim: "",
    smith: "",
    hong: "",
    markup: "",
  };
  /** The report's `[n]` order for the three main fixtures. */
  let order: string[] = [];

  before(async function () {
    for (const name of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
      keys[name] = (await createFixture(FIXTURES[name])).key;
    }
    order = [keys.smith, keys.hong, keys.kim];
  });

  after(async function () {
    try {
      if (createdItemIDs.length > 0) await Zotero.Items.erase(createdItemIDs);
      log(`erased ${createdItemIDs.length} fixture items`);
    } catch (error) {
      log(`cleanup failed: ${String(error)}`);
    }
  });

  it("finds the user's style in Zotero's Quick Copy setting", async function () {
    const styles = Zotero.Styles as { initialized(): boolean };
    const wasInitialized = styles.initialized();
    const start = Date.now();
    const style = await zoteroBibliographyPort.userCitationStyle();
    log(
      `Zotero.Styles initialized before: ${String(wasInitialized)}; ` +
        `userCitationStyle took ${Date.now() - start} ms; ` +
        `Zotero.locale ${Zotero.locale}; result ${JSON.stringify(style)}`,
    );
    const setting = (
      Zotero.QuickCopy as {
        unserializeSetting(s: unknown): { mode?: string; id?: string };
      }
    ).unserializeSetting(Zotero.Prefs.get("export.quickCopy.setting"));
    if (setting.mode !== "bibliography" || setting.id === undefined) {
      assert.fail(
        `the runner profile's Quick Copy setting is not a style: ${JSON.stringify(setting)}`,
      );
    }
    if (style === undefined) assert.fail("no user citation style resolved");
    assert.strictEqual(style.styleId, setting.id);
    assert.strictEqual(style.source, "quickCopy");
  });

  it("formats three items in two styles into different strings, in [n] order", async function () {
    const results: FormattedBibliography[] = [];
    for (const styleId of [APA, IEEE]) {
      const start = Date.now();
      const bib = await zoteroBibliographyPort.formatBibliography(order, {
        libraryID: libraryID(),
        styleId,
        locale: "en-US",
      });
      log(
        `${styleId} en-US (${Date.now() - start} ms): ` + JSON.stringify(bib),
      );
      results.push(bib);
      assert.deepEqual(
        bib.entries.map((e) => e.itemKey),
        order,
        `${styleId}: entries follow the given order`,
      );
      assert.deepEqual(
        bib.entries.map((e) => e.index),
        [1, 2, 3],
      );
      assert.isFalse(bib.citationList);
      for (const entry of bib.entries) {
        assert.isFalse(
          LEADING_LABEL.test(entry.text),
          `${styleId}: no style number left on "${entry.text}"`,
        );
        assert.strictEqual(entry.text, entry.text.trim());
      }
      // Original script survives (docs/11 §1 Phase 4 definition of done).
      assert.include(bib.entries[1]?.text ?? "", FIXTURES.hong.title);
      assert.include(bib.entries[1]?.text ?? "", "홍");
      assert.deepEqual(
        bib.entries.map((e) => String(e.doi)),
        ["10.1000/rh.p4t11.b", "10.1000/rh.p4t11.c", "10.1000/rh.p4t11.a"],
      );
    }
    const [apa, ieee] = results;
    if (apa === undefined || ieee === undefined) assert.fail("two results");
    assert.isFalse(apa.styleNumbered, "APA is author-date");
    assert.isTrue(ieee.styleNumbered, "IEEE numbers its entries");
    for (let i = 0; i < 3; i++) {
      assert.notStrictEqual(
        apa.entries[i]?.text,
        ieee.entries[i]?.text,
        `entry ${i + 1} differs between APA and IEEE`,
      );
    }
    // The measured shapes, so a Zotero update that changes them is seen.
    assert.strictEqual(
      apa.entries[0]?.text,
      "Smith, A. (2022). A survey of graph neural networks. Journal of " +
        "Machine Learning Research, 23, 1–40. https://doi.org/10.1000/rh.p4t11.b",
    );
    assert.strictEqual(
      ieee.entries[0]?.text,
      "A. Smith, “A survey of graph neural networks,” Journal of Machine " +
        "Learning Research, vol. 23, pp. 1–40, 2022, doi: 10.1000/rh.p4t11.b.",
    );
  });

  it("formats with every style Zotero bundles", async function () {
    const visible = (
      Zotero.Styles as { getVisible(): readonly { styleID: string }[] }
    ).getVisible();
    log(`${visible.length} visible styles`);
    let numberedCount = 0;
    for (const { styleID } of visible) {
      const start = Date.now();
      const bib = await zoteroBibliographyPort.formatBibliography(order, {
        libraryID: libraryID(),
        styleId: styleID,
        locale: "en-US",
      });
      if (bib.styleNumbered) numberedCount += 1;
      log(
        `${styleID}: ${Date.now() - start} ms, numbered ` +
          `${String(bib.styleNumbered)}, citationList ` +
          `${String(bib.citationList)}, [1] ${JSON.stringify(bib.entries[0]?.text)}`,
      );
      assert.strictEqual(bib.entries.length, 3, styleID);
      assert.include(
        bib.entries[1]?.text ?? "",
        FIXTURES.hong.title,
        `${styleID}: the Korean title in its original script`,
      );
      for (const entry of bib.entries) {
        assert.isTrue(entry.text.length > 0, `${styleID}: empty entry`);
        assert.isFalse(
          LEADING_LABEL.test(entry.text),
          `${styleID}: no style number left on "${entry.text}"`,
        );
      }
    }
    log(`${numberedCount} of ${visible.length} bundled styles number entries`);
    assert.isTrue(numberedCount > 0, "some bundled style is numeric");
  });

  it("takes the CSL locale from the caller, not from Zotero's UI", async function () {
    const texts: Record<string, readonly string[]> = {};
    for (const locale of ["en-US", "ko-KR"]) {
      const bib = await zoteroBibliographyPort.formatBibliography(order, {
        libraryID: libraryID(),
        styleId: IEEE,
        locale,
      });
      texts[locale] = bib.entries.map((e) => e.text);
      log(`IEEE ${locale}: ${JSON.stringify(texts[locale])}`);
    }
    assert.notStrictEqual(
      JSON.stringify(texts["en-US"]),
      JSON.stringify(texts["ko-KR"]),
      "the locale changes IEEE's text",
    );
    // A style that fixes its own locale ignores the caller's.
    const nature: Record<string, string> = {};
    for (const locale of ["en-US", "ko-KR"]) {
      const bib = await zoteroBibliographyPort.formatBibliography(order, {
        libraryID: libraryID(),
        styleId: NATURE,
        locale,
      });
      nature[locale] = JSON.stringify(bib.entries.map((e) => e.text));
      assert.isTrue(bib.styleNumbered, "Nature numbers its entries");
    }
    log(`Nature en-US ${nature["en-US"]}; ko-KR ${nature["ko-KR"]}`);
  });

  it("formats the retracted list unnumbered, in the given order", async function () {
    const given = [keys.kim, keys.smith];
    const retracted = await zoteroBibliographyPort.formatRetracted(given, {
      libraryID: libraryID(),
      styleId: IEEE,
      locale: "en-US",
    });
    log(`retracted (IEEE): ${JSON.stringify(retracted)}`);
    assert.deepEqual(
      retracted.map((e) => e.itemKey),
      given,
    );
    for (const entry of retracted) {
      assert.isFalse(LEADING_LABEL.test(entry.text), entry.text);
    }
    assert.deepEqual(
      await zoteroBibliographyPort.formatRetracted([], {
        libraryID: libraryID(),
        styleId: IEEE,
        locale: "en-US",
      }),
      [],
    );
  });

  it("refuses a style that is not installed and a key with no item", async function () {
    const request = { libraryID: libraryID(), locale: "en-US" };
    let threw = "";
    try {
      await zoteroBibliographyPort.formatBibliography(order, {
        ...request,
        styleId: "http://www.zotero.org/styles/rh-not-installed",
      });
    } catch (error) {
      threw = String(error);
    }
    assert.include(threw, "citation style not installed");
    threw = "";
    try {
      await zoteroBibliographyPort.formatBibliography(["ZZZZZZZZ"], {
        ...request,
        styleId: APA,
      });
    } catch (error) {
      threw = String(error);
    }
    assert.include(threw, "no regular item ZZZZZZZZ");
  });

  it("builds citation nodes that parse back to the same item URIs", async function () {
    const nodes = await zoteroBibliographyPort.citationNodes(order, {
      libraryID: libraryID(),
      styleId: APA,
      locale: "en-US",
    });
    assert.deepEqual(
      nodes.map((n) => n.itemKey),
      order,
    );
    for (const node of nodes) {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(
        libraryID(),
        node.itemKey,
      );
      if (item === false) assert.fail(`no item ${node.itemKey}`);
      assert.strictEqual(node.uri, String(Zotero.URI.getItemURI(item)));
      assert.deepEqual(parseCitationUris(node.html).citations, [[node.uri]]);
      const back = await Zotero.URI.getURIItem(node.uri);
      assert.strictEqual(
        back.key,
        node.itemKey,
        "the URI resolves to the item",
      );
      log(
        `node ${node.itemKey}: uri ${node.uri}; html ${node.html.replace(/data-citation="[^"]*"/u, 'data-citation="…"')}`,
      );
    }
    // The stored text is the plugin's, in the note editor's shape, with the
    // en-US CSL locale's "and" and "et al." (owner, 2026-10-27, plan/00 §6
    // item 296(a); P4-T13 changed citationNodes).
    assert.include(
      nodes[0]?.html ?? "",
      '>(<span class="citation-item">Smith, 2022</span>)</span>',
    );
    assert.deepEqual(
      nodes.map((n) => n.text),
      ["Smith, 2022", "홍 and Brown, 2023", "Kim et al., 2024"],
    );
    assert.deepEqual(
      nodes.map((n) => n.selectUri),
      order.map((key) => `zotero://select/library/items/${key}`),
    );
    const korean = await zoteroBibliographyPort.citationNodes(order, {
      libraryID: libraryID(),
      styleId: APA,
      locale: "ko-KR",
    });
    log(
      `ko-KR CSL terms in node text (logged, not asserted): ${JSON.stringify(korean.map((n) => n.text))}`,
    );

    // A note holding the wrapper and the nodes reads back byte for byte.
    const html =
      noteWrapperOpenTag(nodes) +
      "<h1>P4-T11 citation nodes</h1>" +
      nodes.map((n) => `<p>${n.html}</p>`).join("") +
      "</div>";
    const note = new Zotero.Item("note");
    note.libraryID = libraryID();
    note.setNote(html);
    note.addTag(FIXTURE_TAG, 1);
    await note.saveTx();
    createdItemIDs.push(note.id);
    const reloaded = await Zotero.Items.getAsync(note.id);
    if (reloaded === false) assert.fail("the note reloads");
    const stored = reloaded.getNote();
    assert.strictEqual(stored, html, "setNote/getNote keep the HTML");
    const parsed = parseCitationUris(stored);
    assert.deepEqual(
      parsed.citations,
      nodes.map((n) => [n.uri]),
    );
    assert.deepEqual(
      parsed.wrapper,
      nodes.map((n) => n.uri),
    );
    log(`note title "${reloaded.getNoteTitle()}"`);
  });

  it("escapes names and titles in the node text, not in the payload", async function () {
    const [node] = await zoteroBibliographyPort.citationNodes([keys.markup], {
      libraryID: libraryID(),
      styleId: APA,
      locale: "en-US",
    });
    if (node === undefined) assert.fail("one node");
    const visible = node.html.replace(/data-citation="[^"]*"/u, "");
    log(`markup node text: ${visible}`);
    assert.include(visible, "O'&lt;Brien&gt; &amp; Sons");
    assert.notInclude(visible, "<Brien>");
    const author = (
      node.citationItem.itemData["author"] as
        readonly { family?: string }[] | undefined
    )?.[0];
    assert.strictEqual(author?.family, "O'<Brien> & Sons");
    assert.strictEqual(
      node.citationItem.itemData["title"],
      FIXTURES.markup.title,
    );
  });

  it("keeps the pure helpers' contracts", function () {
    assert.deepEqual(stripStyleNumbers(["[2] b", "[1] a"]), {
      texts: ["b", "a"],
      numbered: true,
    });
    assert.deepEqual(stripStyleNumbers(["1. a", "2. b"]).texts, ["a", "b"]);
    // Mixed shapes, a gap, or one unlabelled entry: nothing is removed.
    assert.isFalse(stripStyleNumbers(["[1] a", "2. b"]).numbered);
    assert.isFalse(stripStyleNumbers(["[1] a", "[3] b"]).numbered);
    assert.isFalse(stripStyleNumbers(["[1] a", "b"]).numbered);
    assert.isFalse(stripStyleNumbers(["3M Company. (2020). Report."]).numbered);
    assert.deepEqual(
      entriesInOrder([["7"], ["5"]], ["seven\n", " five "], [5, 7]),
      ["five", "seven"],
    );
    let threw = false;
    try {
      entriesInOrder([["7"]], ["seven"], [5]);
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "a missing entry throws");
  });

  it("marks an entry whose record came from Semantic Scholar (P7-T35, item 395(c))", async function () {
    const hong = Zotero.Items.getByLibraryAndKey(libraryID(), keys.hong);
    const kim = Zotero.Items.getByLibraryAndKey(libraryID(), keys.kim);
    if (hong === false || kim === false) assert.fail("fixture items exist");
    const request = { libraryID: libraryID(), styleId: APA, locale: "en-US" };
    const before = await zoteroBibliographyPort.formatBibliography(
      order,
      request,
    );
    assert.deepEqual(
      before.entries.map((e) => e.semanticScholar),
      [undefined, undefined, undefined],
      "an item the plugin did not import is not marked",
    );
    try {
      // The two lines the plugin writes (docs/02 §6.2): the sources list and
      // the corpus id, which only a Semantic Scholar record supplies.
      hong.setField(
        "extra",
        "rh-work-key: w1\nrh-sources: openalex,semanticscholar",
      );
      await hong.saveTx();
      kim.setField("extra", "rh-work-key: w2\nrh-s2-corpus-id: 12345");
      await kim.saveTx();
      const after = await zoteroBibliographyPort.formatBibliography(
        order,
        request,
      );
      log(
        `semanticScholar flags ${JSON.stringify(after.entries.map((e) => e.semanticScholar))}`,
      );
      // order is smith, hong, kim.
      assert.deepEqual(
        after.entries.map((e) => e.semanticScholar),
        [undefined, true, true],
      );
      assert.deepEqual(
        after.entries.map((e) => e.text),
        before.entries.map((e) => e.text),
        "the style's text does not change",
      );
    } finally {
      for (const item of [hong, kim]) {
        item.setField("extra", "");
        await item.saveTx();
      }
    }
  });
});

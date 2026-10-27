/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it writes its own fixture items and notes, opens a note in Zotero's own note editor and reads the editor's document, which no src/zotero/ facade exposes. */
/**
 * `P4-T13` step 4: what Zotero keeps of the report note's HTML — through
 * `setNote`/`getNote`, and through Zotero's note editor when the note is
 * opened in it. The measurement is recorded in `docs/01` §5.7 (the subset)
 * and §5.11 (the citation nodes' text, `plan/00` §6 items 294(b) and
 * 296(a)); this spec
 * is what keeps it true.
 *
 * - **`setNote`/`getNote` keep everything**: the wrapper, citation nodes,
 *   classes, `title`, inline styles and an HTML comment read back byte for
 *   byte.
 * - **Opening the note in the editor and closing it without a change leaves
 *   the stored HTML byte for byte as written.**
 * - **The editor never shows a citation node's stored text.** It renders each
 *   node from the node's item data with its own strings, in Zotero's UI
 *   language — measured with the UI locale pinned to `en-US` and to `ko-KR`
 *   (`test/integration/support/uiLocale.ts`), because the assertions are on
 *   text the UI language decides.
 * - **When the editor saves the note, it rewrites the whole HTML** from its
 *   own schema: the citation text becomes the UI-language text, and the
 *   comment, classes, inline table styles and unknown attributes are gone.
 *   A save is triggered here the way a user could trigger one without typing:
 *   a cited item changes while the note is open.
 *
 * The measuring note is built here from `src/zotero/bibliography.ts`'s
 * helpers, so it can carry things the renderer never writes (a comment, a
 * class, inline styles). The owner accepted the editor's behaviour on
 * 2026-10-27 (`plan/00` §6 item 296(a)); the last test renders a report with
 * the shipped renderer (`renderReportNote` in
 * `src/pipeline/trendReport/noteHtml.ts`) and `zoteroBibliographyPort`, and
 * checks that `setNote` and the editor keep what it writes. No network, no
 * LLM (`docs/13` §2.3). Every fixture carries {@link FIXTURE_TAG} and is
 * erased in `after()`.
 */

import {
  type CitationNode,
  citationSpan,
  escapeHtml,
  noteWrapperOpenTag,
  zoteroBibliographyPort,
} from "../../../src/zotero/bibliography";
import type { TrendReport } from "../../../src/model/trend";
import { renderReportNote } from "../../../src/pipeline/trendReport/noteHtml";
import { pinUILocale, restoreUILocale } from "../support/uiLocale";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
declare function describe(title: string, body: () => void): void;
declare function it(title: string, body: () => Promise<void> | void): void;
declare function before(body: () => Promise<void>): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  include(haystack: string, needle: string, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P4-T13]";
const FIXTURE_TAG = "rh-p4t13-fixture";

/** How long a step may take before the spec gives up. */
const STEP_TIMEOUT_MS = 10_000;
/**
 * How long the spec waits after the editor initialises before reading the
 * stored note: the editor debounces its saves by one second, and its citation
 * refresh is one message round trip.
 */
const SETTLE_MS = 2_000;

interface Fixture {
  readonly title: string;
  readonly creators: readonly (readonly [string, string])[];
  readonly year: string;
  /** The node text the spec writes: English, as an `en-US` report would. */
  readonly pluginText: string;
}

/** One, two and three authors: the three shapes the editor's text takes. */
const FIXTURES = {
  kim: {
    title: "Deep learning for protein structure prediction",
    creators: [
      ["Kim", "Minjun"],
      ["Lee", "Seoyeon"],
      ["Park", "Jiho"],
    ],
    year: "2024",
    pluginText: "Kim et al., 2024",
  },
  hong: {
    title: "단백질 구조 예측의 최근 동향",
    creators: [
      ["홍", "길동"],
      ["Brown", "Carl"],
    ],
    year: "2023",
    pluginText: "홍 and Brown, 2023",
  },
  smith: {
    title: "A survey of graph neural networks",
    creators: [["Smith", "Anna"]],
    year: "2022",
    pluginText: "Smith, 2022",
  },
} as const satisfies Record<string, Fixture>;

type FixtureName = keyof typeof FIXTURES;
const ORDER: readonly FixtureName[] = ["kim", "hong", "smith"];

/** The editor's text for each fixture, per pinned UI locale (measured). */
const EDITOR_TEXT: Record<"en-US" | "ko-KR", Record<FixtureName, string>> = {
  "en-US": {
    kim: "(Kim et al., 2024)",
    hong: "(홍 and Brown, 2023)",
    smith: "(Smith, 2022)",
  },
  "ko-KR": {
    kim: "(Kim 등, 2024)",
    hong: "(홍 그리고 Brown, 2023)",
    smith: "(Smith, 2022)",
  },
};

/** The marker comment `docs/07` §6.5 puts on a report note. */
const MARKER_COMMENT = "<!-- rh:report v=1 id=p4t13-fixture -->";

const APA = "http://www.zotero.org/styles/apa";

const createdItemIDs: number[] = [];
const libraryID = (): number => Zotero.Libraries.userLibraryID;

function log(line: string): void {
  // The payloads are long and say nothing here; newlines would end the line.
  debug(
    `${LOG_PREFIX} ${line
      .replace(/data-citation(-items)?="[^"]*"/gu, "data-citation$1=…")
      .replace(/\n/gu, "\\n")}`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > STEP_TIMEOUT_MS) {
      assert.fail(`timed out after ${STEP_TIMEOUT_MS} ms waiting for ${what}`);
    }
    await delay(100);
  }
}

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
  item.addTag(FIXTURE_TAG, 1);
  await item.saveTx();
  createdItemIDs.push(item.id);
  return item;
}

/**
 * A note holding every construct of `docs/06` §14.1's table as
 * `docs/06` §10.2 and §14.1 describe them, plus the things whose survival is
 * the question: the marker comment, a class and a `title` on the inline
 * anchor, inline table styles, `<code>` inside `<pre>`, and a paragraph with
 * a class, a `title` and a `data-` attribute.
 */
function noteHtml(nodes: readonly CitationNode[], firstKey: string): string {
  const spans = nodes.map((node, i) => {
    const name = ORDER[i];
    const text = name === undefined ? "" : FIXTURES[name].pluginText;
    return citationSpan(
      node.citationItem,
      `(<span class="citation-item">${escapeHtml(text)}</span>)`,
    );
  });
  const cell = "border: 1px solid #ccc; padding: 4px";
  return (
    noteWrapperOpenTag(nodes) +
    MARKER_COMMENT +
    `<h1>Research Trends: P4-T13 fixture</h1>` +
    `<p><em>3 papers · 2022–2024</em></p>` +
    `<h2>1. Executive Summary</h2>` +
    `<ul><li><p>A claim <a href="zotero://select/library/items/${firstKey}" ` +
    `class="rh-cite" title="Kim et al., 2024">[1]</a>, ` +
    `<strong>bold</strong>, <span style="text-decoration: line-through">struck</span> ` +
    `and <code>x &lt; y</code>.</p></li></ul>` +
    `<ol><li><p>first</p></li><li><p>second</p></li></ol>` +
    `<blockquote><p>quoted</p></blockquote>` +
    `<pre><code>fenced [[ABCD1234]]</code></pre>` +
    `<h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>` +
    `<h2>10. Notable Papers</h2>` +
    `<table style="border-collapse: collapse"><tr>` +
    `<th style="${cell}; text-align: left">Paper</th><th style="${cell}">Year</th></tr>` +
    `<tr><td style="${cell}">${spans[0] ?? ""}</td><td style="${cell}">2024</td></tr>` +
    `</table>` +
    `<h2>11. Bibliography</h2>` +
    spans
      .map(
        (span, i) =>
          `<p>[${i + 1}] ${span} Entry text. ` +
          `<a href="https://doi.org/10.1000/rh.p4t13">https://doi.org/10.1000/rh.p4t13</a></p>`,
      )
      .join("") +
    `<p class="rh-x" title="a title" data-rh="1">attributes</p>` +
    `</div>`
  );
}

/** `Zotero.EditorInstance`, as far as this spec reads it. */
interface EditorInstanceLike {
  readonly _initPromise: Promise<void>;
  readonly _iframeWindow: Window & {
    readonly wrappedJSObject: {
      /** `null` when `onlyChanged` and nothing changed since the last save. */
      getDataSync(onlyChanged: boolean): unknown;
    };
  };
}

interface NotesLike {
  open(
    itemID: number,
    location: null,
    options: { openInWindow: boolean },
  ): Promise<EditorInstanceLike | null>;
  readonly _editorInstances: readonly EditorInstanceLike[];
}

interface OpenEditor {
  readonly instance: EditorInstanceLike;
  readonly window: Window;
}

/** Open the note in its own note-editor window and wait for the editor. */
async function openInEditor(noteID: number): Promise<OpenEditor> {
  const notes = Zotero.Notes as unknown as NotesLike;
  const start = Date.now();
  const instance = await notes.open(noteID, null, { openInWindow: true });
  if (instance === null) assert.fail("the note editor opened");
  await instance._initPromise;
  const window = Services.ww.getWindowByName(
    `zotero-note-${noteID}`,
  ) as unknown as Window | null;
  if (window === null) assert.fail("the note window is found by its name");
  log(`editor ready after ${Date.now() - start} ms`);
  return { instance, window };
}

/** Close the note window and wait until its editor has unregistered. */
async function closeEditor(editor: OpenEditor): Promise<void> {
  editor.window.close();
  const notes = Zotero.Notes as unknown as NotesLike;
  await waitUntil(
    () => !notes._editorInstances.includes(editor.instance),
    "the note editor to unregister",
  );
}

/** The `span.citation` texts the editor displays, in document order. */
function displayedCitations(editor: OpenEditor): string[] {
  return [
    ...editor.instance._iframeWindow.document.querySelectorAll("span.citation"),
  ].map((span) => span.textContent);
}

/** The HTML the editor would save now, whether or not anything changed. */
function editorSerialization(editor: OpenEditor): string {
  const data = JSON.parse(
    JSON.stringify(
      editor.instance._iframeWindow.wrappedJSObject.getDataSync(false),
    ),
  ) as { html?: unknown } | null;
  if (typeof data?.html !== "string") assert.fail("the editor returns HTML");
  return data.html;
}

async function storedNote(noteID: number): Promise<string> {
  const note = await Zotero.Items.getAsync(noteID);
  if (note === false) assert.fail("the note reloads");
  return note.getNote();
}

describe("Report note HTML through setNote and the note editor (P4-T13)", function () {
  const items = {} as Record<FixtureName, Zotero.Item>;
  let nodes: readonly CitationNode[] = [];

  before(async function () {
    for (const name of ORDER) items[name] = await createFixture(FIXTURES[name]);
    nodes = await zoteroBibliographyPort.citationNodes(
      ORDER.map((name) => items[name].key),
      { libraryID: libraryID(), styleId: APA, locale: "en-US" },
    );
  });

  after(async function () {
    try {
      if (createdItemIDs.length > 0) await Zotero.Items.erase(createdItemIDs);
      log(`erased ${createdItemIDs.length} fixture items and notes`);
    } catch (error) {
      log(`cleanup failed: ${String(error)}`);
    }
  });

  async function saveNote(): Promise<{ id: number; html: string }> {
    const html = noteHtml(nodes, items.kim.key);
    const note = new Zotero.Item("note");
    note.libraryID = libraryID();
    note.setNote(html);
    note.addTag(FIXTURE_TAG, 1);
    await note.saveTx();
    createdItemIDs.push(note.id);
    return { id: note.id, html };
  }

  it("keeps the wrapper, nodes, classes, title, inline styles and the comment through setNote", async function () {
    const { id, html } = await saveNote();
    const stored = await storedNote(id);
    assert.strictEqual(stored, html, "getNote returns what setNote was given");
    for (const kept of [
      MARKER_COMMENT,
      'data-schema-version="9"',
      'class="rh-cite"',
      'title="Kim et al., 2024"',
      'style="border-collapse: collapse"',
      "<pre><code>",
      'data-rh="1"',
    ]) {
      assert.include(stored, kept);
    }
  });

  it("leaves the stored HTML as written when the note is opened and closed unchanged, and shows the nodes in en-US", async function () {
    const snapshot = await pinUILocale(["en-US"], log);
    try {
      const { id, html } = await saveNote();
      const editor = await openInEditor(id);
      try {
        await delay(SETTLE_MS);
        const shown = displayedCitations(editor);
        log(`en-US: the editor shows ${JSON.stringify(shown)}`);
        const english = EDITOR_TEXT["en-US"];
        assert.deepEqual(shown, [
          english.kim,
          english.kim,
          english.hong,
          english.smith,
        ]);
        assert.strictEqual(
          await storedNote(id),
          html,
          "opening the note does not save it",
        );

        const serialized = editorSerialization(editor);
        log(`the editor would save: ${serialized}`);
        // Kept: the wrapper, every §14.1 construct, the anchor's href and title.
        for (const kept of [
          'data-schema-version="9"',
          "data-citation-items=",
          "<h1>Research Trends: P4-T13 fixture</h1>",
          "<h6>h6</h6>",
          "<strong>bold</strong>",
          "<em>3 papers · 2022–2024</em>",
          '<span style="text-decoration: line-through;">struck</span>',
          "<code>x &lt; y</code>",
          "<ul>",
          "<ol>",
          "<blockquote>",
          "<pre>fenced [[ABCD1234]]</pre>",
          "<table>",
          "<th>",
          "<td>",
          `href="zotero://select/library/items/${items.kim.key}"`,
          'title="Kim et al., 2024"',
          'href="https://doi.org/10.1000/rh.p4t13"',
          '<span class="citation" data-citation=',
          '<span class="citation-item">Kim et al., 2024</span>',
        ]) {
          assert.include(serialized, kept);
        }
        // Dropped: the comment, every class but the citation's, inline table
        // styles, `<code>` inside `<pre>`, unknown attributes.
        for (const dropped of [
          "<!--",
          "rh-cite",
          "rh-x",
          "border",
          "<pre><code>",
          "data-rh",
          'title="a title"',
        ]) {
          assert.notInclude(serialized, dropped);
        }
        // Added: rel on every link, tbody, a paragraph in every cell.
        for (const added of [
          'rel="noopener noreferrer nofollow"',
          "<tbody>",
          "<th>\n<p>Paper</p>",
        ]) {
          assert.include(serialized, added);
        }
      } finally {
        await closeEditor(editor);
      }
      assert.strictEqual(
        await storedNote(id),
        html,
        "closing the unchanged note does not save it",
      );
    } finally {
      await restoreUILocale(snapshot, log);
    }
  });

  it("shows the nodes in ko-KR, and rewrites the stored HTML in the UI language when it saves", async function () {
    const snapshot = await pinUILocale(["ko-KR", "en-US"], log);
    try {
      const { id, html } = await saveNote();
      const editor = await openInEditor(id);
      const korean = EDITOR_TEXT["ko-KR"];
      try {
        await delay(SETTLE_MS);
        const shown = displayedCitations(editor);
        log(`ko-KR: the editor shows ${JSON.stringify(shown)}`);
        assert.deepEqual(shown, [
          korean.kim,
          korean.kim,
          korean.hong,
          korean.smith,
        ]);
        assert.strictEqual(await storedNote(id), html, "not saved on opening");

        // A cited item changes while the note is open: the editor refreshes
        // the node's item data and saves the note.
        items.smith.setField("title", `${FIXTURES.smith.title} (revised)`);
        await items.smith.saveTx();
        await waitUntil(
          async () => (await storedNote(id)) !== html,
          "the editor to save the note",
        );
      } finally {
        await closeEditor(editor);
      }
      const saved = await storedNote(id);
      log(`ko-KR: the editor saved: ${saved}`);
      for (const name of ["kim", "hong"] as const) {
        assert.include(
          saved,
          `<span class="citation-item">${korean[name].slice(1, -1)}</span>`,
          `${name}'s node text is the editor's`,
        );
        assert.notInclude(
          saved,
          `<span class="citation-item">${escapeHtml(FIXTURES[name].pluginText)}</span>`,
          `${name}'s written node text is gone`,
        );
      }
      // The anchor's title is an attribute the editor keeps as written.
      assert.include(saved, 'title="Kim et al., 2024"');
      assert.notInclude(saved, "<!--", "the marker comment is gone");
      assert.notInclude(saved, "rh-cite");
      assert.include(saved, 'data-schema-version="9"');
      assert.include(saved, "revised", "the wrapper carries the new item data");
    } finally {
      await restoreUILocale(snapshot, log);
    }
  });

  it("renders a report with the shipped renderer, which setNote keeps byte for byte and the editor keeps in substance", async function () {
    const keys = ORDER.map((name) => items[name].key);
    const [kim, hong, smith] = keys as [string, string, string];
    const request = { libraryID: libraryID(), styleId: APA, locale: "en-US" };
    const formatted = await zoteroBibliographyPort.formatBibliography(
      keys,
      request,
    );
    const headings = [
      "1. Executive Summary",
      "2. Scope and Method",
      "3. Landscape Overview",
      "4. Major Research Themes",
      "5. Methodological Trends",
      "6. Key Findings and Convergence",
      "7. Contradictions and Debates",
      "8. Gaps and Open Questions",
      "9. Emerging Directions",
      "10. Notable Papers",
      "11. Bibliography",
    ];
    const body: Record<number, string> = {
      1: `- Protein models improved [[${kim}]], and [[${hong}]] reviewed them **in Korean**.`,
      3: "| Year | Papers |\n| --- | --- |\n| 2024 | 1 |",
      9: `<script>alert(1)</script> and [x](zotero://select/library/items/${kim})`,
      10:
        "| Paper | Year | Why it matters | Theme |\n| --- | --- | --- | --- |\n" +
        `| [[${smith}]] | 2022 | A survey. | Graphs |`,
      11: "Replaced.",
    };
    const markdown = [
      "# Research Trends: P4-T13 renderer",
      "",
      ...headings.flatMap((heading, i) => [
        `## ${heading}`,
        "",
        body[i + 1] ?? "None.",
        "",
      ]),
    ].join("\n");
    const report = {
      libraryID: libraryID(),
      markdown,
      sections: headings.map((heading, i) => ({
        number: i + 1,
        heading,
        markdown: "",
        citedItemKeys: [],
      })),
      bibliography: formatted.entries,
      retracted: [],
    } as unknown as TrendReport;
    const html = await renderReportNote(report, {
      port: zoteroBibliographyPort,
      request,
    });
    log(`renderer output: ${html}`);

    const note = new Zotero.Item("note");
    note.libraryID = libraryID();
    note.setNote(html);
    note.addTag(FIXTURE_TAG, 1);
    await note.saveTx();
    createdItemIDs.push(note.id);
    assert.strictEqual(await storedNote(note.id), html, "setNote keeps it");
    assert.include(
      html,
      '<span class="citation-item">Kim et al., 2024</span>',
      "the stored node text is the plugin's en-US text",
    );
    assert.notInclude(html, "<script");
    assert.notInclude(
      html,
      'href="zotero://select/library/items/' + kim + '">x',
    );

    const snapshot = await pinUILocale(["en-US"], log);
    try {
      const editor = await openInEditor(note.id);
      try {
        await delay(SETTLE_MS);
        const serialized = editorSerialization(editor);
        log(`the editor would save the rendered report as: ${serialized}`);
        const shown = displayedCitations(editor);
        log(`en-US: the editor shows ${JSON.stringify(shown)}`);
        // One node in the Notable Papers table, one per bibliography entry.
        assert.strictEqual(shown.length, 4);
        for (const [n, key] of [
          [1, kim],
          [2, hong],
        ] as const) {
          assert.include(
            serialized,
            `href="zotero://select/library/items/${key}"`,
          );
          assert.include(serialized, `>[${n}]</a>`);
        }
        assert.include(serialized, 'title="Kim et al., 2024"');
        assert.include(serialized, "<strong>in Korean</strong>");
        assert.include(serialized, "<table>");
        assert.include(serialized, "&lt;script&gt;");
        assert.include(serialized, "<h2>11. Bibliography</h2>");
        assert.notInclude(serialized, "Replaced.");
        assert.strictEqual(
          await storedNote(note.id),
          html,
          "opening the rendered note does not save it",
        );
      } finally {
        await closeEditor(editor);
      }
    } finally {
      await restoreUILocale(snapshot, log);
    }
  });
});

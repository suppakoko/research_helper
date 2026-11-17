/**
 * `P4-T13` — the trend report as Zotero note HTML (`docs/06` §14.1, §10.2;
 * the measured note schema `docs/01` §5.7, the citation nodes §5.11).
 *
 * Every report here is synthetic and written in this file, and the citation
 * nodes come from a fake port built with `citationSpan`, the real node markup.
 * No network, no model, no Zotero.
 */

import { describe, expect, it, vi } from "vitest";

import type { Doi } from "../../../src/model/ids";
import type {
  BibliographyEntry,
  RetractedEntry,
  TrendReport,
} from "../../../src/model/trend";
import {
  assertNoteHtmlAllowed,
  renderInline,
  renderReportNote,
  renderReportNoteHtml,
} from "../../../src/pipeline/trendReport/noteHtml";
import {
  type BibliographyPort,
  type CitationNode,
  citationPreviewText,
  citationSpan,
  escapeHtml,
  parseCitationUris,
} from "../../../src/zotero/bibliography";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const A = "AAAA1111";
const B = "BBBB2222";
const C = "CCCC3333";
const R = "RETR0001";

const doi = (d: string): Doi => d as Doi;

/** The private-use characters `noteHtml.ts` gives a meaning to, and U+FFFD. */
const CITE_OPEN = String.fromCharCode(0xe000);
const CITE_CLOSE = String.fromCharCode(0xe001);
const REPLACEMENT = String.fromCharCode(0xfffd);

/** A node as `citationNodes` makes it, for a key and its plain text. */
function node(itemKey: string, text: string): CitationNode {
  const uri = `http://zotero.org/users/local/abcdefgh/items/${itemKey}`;
  const citationItem = {
    uris: [uri],
    itemData: { id: uri, type: "article-journal", title: `Title ${itemKey}` },
  };
  return {
    itemKey,
    uri,
    selectUri: `zotero://select/library/items/${itemKey}`,
    text,
    html: citationSpan(
      citationItem,
      `(<span class="citation-item">${escapeHtml(text)}</span>)`,
    ),
    citationItem,
  };
}

const NODES: readonly CitationNode[] = [
  node(B, "Kim and Lee, 2024"),
  node(A, "Park, 2020"),
  node(C, "O'<Brien> & Sons, 2023"),
];

const ENTRY_B: BibliographyEntry = {
  itemKey: B,
  index: 1,
  text:
    "Kim, J., & Lee, S. (2024). Polygenic scores in practice. Nature " +
    "Medicine, 30(2), 1–9. https://doi.org/10.1038/S41591-024-0001-X",
  doi: doi("10.1038/s41591-024-0001-x"),
};
const ENTRY_A: BibliographyEntry = {
  itemKey: A,
  index: 2,
  text: 'J. Park, "Risk models," Circulation, vol. 1, pp. 1–2, 2020, doi: 10.1161/circ.1.',
  doi: doi("10.1161/circ.1"),
};
const ENTRY_C: BibliographyEntry = {
  itemKey: C,
  index: 3,
  text: "O'<Brien> & Sons (2023). A <b>bold</b> title with *stars*.",
  doi: undefined,
};
const RETRACTED: RetractedEntry = {
  itemKey: R,
  text: "Retracted, A. (2019). Withdrawn study. https://doi.org/10.5555/retr.1",
  doi: doi("10.5555/retr.1"),
};

const HEADINGS = [
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
] as const;

/** One line per construct of `docs/06` §14.1's table, in the eleven sections. */
const MARKDOWN = [
  "# Research Trends: Cardio / Risk",
  "_3 papers · 2020–2024 · generated 2026-10-27 by research_helper v0.0.2_",
  "",
  `## ${HEADINGS[0]}`,
  "",
  `- Scores improved **discrimination** [[${B}]] and replicated [[${A}]] [[${B}]].`,
  "- A *second* bullet with __strong__ and _em_ and ~~struck~~ text.",
  "  - a nested bullet",
  "",
  `## ${HEADINGS[1]}`,
  "",
  "A paragraph that runs",
  "over two lines with `inline <code>` in it.",
  "",
  "1. first step",
  "2. second step",
  "",
  `## ${HEADINGS[2]}`,
  "",
  "| Year | Papers |",
  "| ---: | :--- |",
  "| 2024 | 2 |",
  "",
  `## ${HEADINGS[3]}`,
  "",
  "### Theme one",
  "#### Level four",
  "##### Level five",
  "###### Level six",
  "",
  "> A quoted finding.",
  "> Second quoted line.",
  "",
  `## ${HEADINGS[4]}`,
  "",
  "```",
  "fenced [[ZZZZ9999]] <kept> as written",
  "```",
  "",
  `## ${HEADINGS[5]}`,
  "",
  "![a figure](https://example.org/figure.png) is not an image.",
  "",
  `## ${HEADINGS[6]}`,
  "",
  "None.",
  "",
  `## ${HEADINGS[7]}`,
  "",
  "None.",
  "",
  `## ${HEADINGS[8]}`,
  "",
  "None.",
  "",
  `## ${HEADINGS[9]}`,
  "",
  "| Paper | Year | Why it matters | Theme |",
  "| --- | --- | --- | --- |",
  `| [[${C}]] | 2023 | Builds on [[${A}]]. | Risk |`,
  "",
  `## ${HEADINGS[10]}`,
  "",
  "Whatever the scaffold wrote here is replaced.",
  "",
  "## Appendix A — Excluded from synthesis",
  "",
  `- ${R}: retracted`,
  "",
].join("\n");

function report(overrides: Partial<TrendReport> = {}): TrendReport {
  return {
    id: "report-0001",
    libraryID: 1,
    collectionKey: "COLL0001",
    collectionName: "Cardio / Risk",
    title: "Research Trends: Cardio / Risk (2026-10-27)",
    language: "en",
    generatedAtEpochMs: Date.UTC(2026, 9, 27),
    pluginVersion: "0.0.2",
    scope: {
      totalCount: 4,
      analysedCount: 3,
      excludedCount: 1,
      fullTextCount: 1,
      abstractCount: 2,
      yearMin: 2020,
      yearMax: 2024,
    },
    reductionPasses: 0,
    sections: HEADINGS.map((heading, i) => ({
      number: (i + 1) as TrendReport["sections"][number]["number"],
      heading,
      markdown: "",
      citedItemKeys: [],
    })),
    clustering: { themes: [], assignments: [] },
    bibliography: [ENTRY_C, ENTRY_A, ENTRY_B],
    retracted: [RETRACTED],
    excluded: [{ itemKey: R, reason: "retracted" }],
    summaryIds: [],
    qualityProxies: {
      citationDensity: undefined,
      coverageRatio: 1,
      brokenCitationCount: 0,
      meanGroundingScore: undefined,
      contradictionCount: 0,
      unresolvedHighSeverityCount: 0,
    },
    critique: { rounds: 0, unresolved: [], revisedAfterLastCritique: false },
    markdown: MARKDOWN,
    audioScripts: {},
    providerId: "anthropic",
    prompts: [],
    usage: undefined,
    citedItemKeys: [B, A, C],
    warnings: [],
    ...overrides,
  };
}

function render(overrides: Partial<TrendReport> = {}): string {
  return renderReportNoteHtml(report(overrides), NODES);
}

/** The report with `line` (unique in the fixture) replaced. */
function withLine(from: string, to: string): Partial<TrendReport> {
  if (MARKDOWN.split(from).length !== 2) throw new Error(`not unique: ${from}`);
  return { markdown: MARKDOWN.replace(from, to) };
}

const anchor = (key: string, n: number, title: string): string =>
  `<a href="zotero://select/library/items/${key}" title="${title}">[${n}]</a>`;

// ---------------------------------------------------------------------------
// The note
// ---------------------------------------------------------------------------

describe("renderReportNoteHtml", () => {
  const html = render();

  it("wraps the note in the schema-9 wrapper carrying every cited item once, in [n] order", () => {
    expect(html.startsWith("<div data-citation-items=")).toBe(true);
    expect(html).toContain('data-schema-version="9">');
    expect(html.endsWith("</div>")).toBe(true);
    expect(html).not.toContain("znv1");
    expect(parseCitationUris(html).wrapper).toEqual(
      [B, A, C].map((k) => `http://zotero.org/users/local/abcdefgh/items/${k}`),
    );
  });

  it("converts the headings, h1 to h6", () => {
    expect(html).toContain("<h1>Research Trends: Cardio / Risk</h1>");
    expect(html).toContain(`<h2>${HEADINGS[0]}</h2>`);
    expect(html).toContain("<h3>Theme one</h3>");
    expect(html).toContain("<h4>Level four</h4>");
    expect(html).toContain("<h5>Level five</h5>");
    expect(html).toContain("<h6>Level six</h6>");
  });

  it("converts paragraphs, joining a paragraph's lines", () => {
    expect(html).toContain(
      "<p>A paragraph that runs over two lines with <code>inline &lt;code&gt;</code> in it.</p>",
    );
    expect(html).toContain(
      "<p><em>3 papers · 2020–2024 · generated 2026-10-27 by research_helper v0.0.2</em></p>",
    );
  });

  it("converts bold, italic and strike, with both delimiters", () => {
    expect(html).toContain("<strong>discrimination</strong>");
    expect(html).toContain(
      "A <em>second</em> bullet with <strong>strong</strong> and <em>em</em> and " +
        '<span style="text-decoration: line-through">struck</span> text.',
    );
  });

  it("converts bullet, numbered and nested lists", () => {
    expect(html).toContain(
      "<ul><li><p>Scores improved <strong>discrimination</strong>",
    );
    expect(html).toContain("<ul><li><p>a nested bullet</p></li></ul>");
    expect(html).toContain(
      "<ol><li><p>first step</p></li><li><p>second step</p></li></ol>",
    );
  });

  it("converts a table to th and td cells, with no inline style", () => {
    expect(html).toContain(
      "<table><tr><th>Year</th><th>Papers</th></tr><tr><td>2024</td><td>2</td></tr></table>",
    );
    expect(html).not.toMatch(/<t[hd][^>]/);
  });

  it("converts a blockquote", () => {
    expect(html).toContain(
      "<blockquote><p>A quoted finding. Second quoted line.</p></blockquote>",
    );
  });

  it("keeps a fenced block as written, as escaped text in a pre, its marker untouched", () => {
    expect(html).toContain(
      "<pre>fenced [[ZZZZ9999]] &lt;kept&gt; as written</pre>",
    );
    expect(html).not.toContain("<pre><code>");
  });

  it("emits no image: its Markdown stays as text, unlinked", () => {
    expect(html).not.toContain("<img");
    expect(html).toContain(
      "<p>![a figure](https://example.org/figure.png) is not an image.</p>",
    );
  });

  it("makes body markers zotero://select anchors numbered by first appearance, titled with the node text", () => {
    expect(html).toContain(
      `discrimination</strong> ${anchor(B, 1, "Kim and Lee, 2024")} and replicated ` +
        `${anchor(A, 2, "Park, 2020")} ${anchor(B, 1, "Kim and Lee, 2024")}.`,
    );
  });

  it("makes the first cell of a Notable Papers row a citation node, and other cells anchors", () => {
    const nodeC = NODES[2] as CitationNode;
    expect(html).toContain(
      `<tr><td>${nodeC.html}</td><td>2023</td><td>Builds on ${anchor(A, 2, "Park, 2020")}.</td><td>Risk</td></tr>`,
    );
  });

  it("escapes a node's text in an anchor title", () => {
    const tricky = renderReportNoteHtml(
      report(withLine("None.\n\n## 8.", `See [[${C}]].\n\n## 8.`)),
      NODES,
    );
    expect(tricky).toContain(
      'title="O\'&lt;Brien&gt; &amp; Sons, 2023">[3]</a>',
    );
  });

  it("replaces §11's body with numbered entries, each with its node and exactly one DOI link", () => {
    expect(html).not.toContain("Whatever the scaffold wrote");
    const [nodeB, nodeA, nodeC] = NODES as [
      CitationNode,
      CitationNode,
      CitationNode,
    ];
    expect(html).toContain(
      `<h2>${HEADINGS[10]}</h2>` +
        `<p>[1] ${nodeB.html} Kim, J., &amp; Lee, S. (2024). Polygenic scores in practice. ` +
        "Nature Medicine, 30(2), 1–9. " +
        '<a href="https://doi.org/10.1038/s41591-024-0001-x">https://doi.org/10.1038/S41591-024-0001-X</a></p>' +
        `<p>[2] ${nodeA.html} J. Park, &quot;Risk models,&quot; Circulation, vol. 1, pp. 1–2, 2020, ` +
        'doi: 10.1161/circ.1. <a href="https://doi.org/10.1161/circ.1">https://doi.org/10.1161/circ.1</a></p>' +
        `<p>[3] ${nodeC.html} O'&lt;Brien&gt; &amp; Sons (2023). A &lt;b&gt;bold&lt;/b&gt; title with *stars*.</p>`,
    );
    expect(
      html.match(/href="https:\/\/doi\.org\/10\.1161\/circ\.1"/g),
    ).toHaveLength(1);
  });

  it("puts the unnumbered retracted list after the entries, without nodes", () => {
    expect(html).toContain(
      "<h3>Retracted — not used in this report</h3><ul><li><p>Retracted, A. (2019). Withdrawn study. " +
        '<a href="https://doi.org/10.5555/retr.1">https://doi.org/10.5555/retr.1</a></p></li></ul>' +
        "<h2>Appendix A — Excluded from synthesis</h2>",
    );
    const none = renderReportNoteHtml(report({ retracted: [] }), NODES);
    expect(none).not.toContain("Retracted —");
    const ko = renderReportNoteHtml(report(), NODES, {
      retractedHeading: "철회 — 이 보고서에 쓰이지 않음",
    });
    expect(ko).toContain("<h3>철회 — 이 보고서에 쓰이지 않음</h3>");
  });

  it("leaves no [[ outside a pre", () => {
    expect(html.replace(/<pre>[\s\S]*?<\/pre>/g, "")).not.toContain("[[");
  });

  it("relies on nothing outside the measured schema: no comment, no class but citation's, one style", () => {
    expect(html).not.toContain("<!--");
    for (const cls of html.matchAll(/class="([^"]*)"/g)) {
      expect(["citation", "citation-item"]).toContain(cls[1]);
    }
    for (const style of html.matchAll(/style="([^"]*)"/g)) {
      expect(style[1]).toBe("text-decoration: line-through");
    }
    expect(() => assertNoteHtmlAllowed(html)).not.toThrow();
  });

  it("shows a private-use character the model wrote as a replacement, never as a citation", () => {
    const out = render(
      withLine("None.\n\n## 8.", `x ${CITE_OPEN}1${CITE_CLOSE} y\n\n## 8.`),
    );
    expect(out).toContain(`<p>x ${REPLACEMENT}1${REPLACEMENT} y</p>`);
  });
});

describe("renderReportNoteHtml — the Semantic Scholar line (P7-T35, item 395(c))", () => {
  const LINE = "Some records: Semantic Scholar, Allen Institute for AI.";
  const s2 = (entry: BibliographyEntry): BibliographyEntry => ({
    ...entry,
    semanticScholar: true,
  });

  it("is absent when no cited record came from Semantic Scholar", () => {
    expect(render()).not.toContain("Semantic Scholar");
  });

  it("follows the numbered entries and comes before the retracted list", () => {
    const html = render({ bibliography: [ENTRY_C, ENTRY_A, s2(ENTRY_B)] });
    expect(html.split(LINE)).toHaveLength(2);
    expect(html).toContain(
      `title with *stars*.</p><p>${LINE}</p><h3>Retracted — not used in this report</h3>`,
    );
    // Removing the line gives the plain render back.
    expect(html.replace(`<p>${LINE}</p>`, "")).toBe(render());
  });

  it("closes §11 when the run kept no retracted entry, and takes the caller's text, escaped", () => {
    const html = renderReportNoteHtml(
      report({ bibliography: [s2(ENTRY_C), ENTRY_A, ENTRY_B], retracted: [] }),
      NODES,
      { semanticScholarAttribution: "<b>caller</b> & line" },
    );
    expect(html).toContain(
      "<p>&lt;b&gt;caller&lt;/b&gt; &amp; line</p><h2>Appendix A — Excluded from synthesis</h2>",
    );
    expect(html).not.toContain(LINE);
    expect(() => {
      assertNoteHtmlAllowed(html);
    }).not.toThrow();
  });
});

describe("renderReportNoteHtml — model output is never trusted", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)" onclick="steal()">click</a>',
    "[js](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [ok](https://example.org/a_b_c)",
    '<!-- a comment --> <div style="x">div</div> <span class="citation">fake</span>',
    `[[${A}]](https://evil.example) and [z](zotero://select/library/items/${A})`,
  ].join("\n\n");
  const html = render(withLine("None.\n\n## 9.", `${hostile}\n\n## 9.`));

  it("renders <script>, onclick, javascript: and data: links with none of them active", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i);
    expect(html).not.toMatch(/href="(?:javascript|data):/i);
    expect(html).not.toContain("<!--");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("[js](javascript:alert(1))");
  });

  it("links only an http(s) address the model wrote", () => {
    expect(html).toContain('<a href="https://example.org/a_b_c">ok</a>');
    expect(html).toContain(`[z](zotero://select/library/items/${A})</p>`);
  });

  it("keeps a marker followed by (…) an anchor [n], the bracketed text visible", () => {
    expect(html).toContain(
      `<p>${anchor(A, 2, "Park, 2020")}(https://evil.example) and `,
    );
  });

  it("shows the model's own div, span and comment as text", () => {
    expect(html).toContain(
      "&lt;!-- a comment --&gt; &lt;div style=&quot;x&quot;&gt;div&lt;/div&gt; " +
        "&lt;span class=&quot;citation&quot;&gt;fake&lt;/span&gt;",
    );
    expect(() => assertNoteHtmlAllowed(html)).not.toThrow();
  });
});

describe("renderReportNoteHtml — refusals", () => {
  it("refuses a report missing a section heading, or with one out of order", () => {
    expect(() => render(withLine(`## ${HEADINGS[4]}\n`, "Methods\n"))).toThrow(
      /section heading appears 0 times/,
    );
    const swapped = MARKDOWN.replace(`## ${HEADINGS[6]}`, "## SWAP")
      .replace(`## ${HEADINGS[7]}`, `## ${HEADINGS[6]}`)
      .replace("## SWAP", `## ${HEADINGS[7]}`);
    expect(() => render({ markdown: swapped })).toThrow(/out of order/);
  });

  it("refuses a bibliography that disagrees with the text's first-appearance order", () => {
    expect(() =>
      render({
        bibliography: [
          { ...ENTRY_B, index: 2 },
          { ...ENTRY_A, index: 1 },
          ENTRY_C,
        ],
      }),
    ).toThrow(/bibliography/);
    expect(() =>
      render({ bibliography: [ENTRY_B, { ...ENTRY_A, index: 3 }] }),
    ).toThrow(/1…n/);
  });

  it("refuses an entry with no citation node", () => {
    expect(() => renderReportNoteHtml(report(), NODES.slice(0, 2))).toThrow(
      /no citation node/,
    );
  });
});

describe("renderReportNote", () => {
  it("asks the port for one node per entry, in [n] order, with the run's request", async () => {
    const citationNodes = vi.fn(async () => NODES);
    const port: BibliographyPort = {
      userCitationStyle: vi.fn(),
      formatBibliography: vi.fn(),
      formatRetracted: vi.fn(),
      citationNodes,
    };
    const request = {
      libraryID: 1,
      styleId: "http://www.zotero.org/styles/apa",
      locale: "en-US",
    };
    const html = await renderReportNote(report(), { port, request });
    expect(citationNodes).toHaveBeenCalledWith([B, A, C], request);
    expect(html).toBe(render());
    await expect(
      renderReportNote(report(), {
        port,
        request: { ...request, libraryID: 2 },
      }),
    ).rejects.toThrow(/another library/);
  });
});

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

describe("assertNoteHtmlAllowed", () => {
  it.each([
    ["a script", "<script>x</script>"],
    ["a comment", "<!-- c -->"],
    ["a javascript: link", '<a href="javascript:x">x</a>'],
    ["a data: link", '<a href="data:text/html,x">x</a>'],
    ["a class on a paragraph", '<p class="x">x</p>'],
    ["an event handler", '<div onclick="x">x</div>'],
    ["a bare span", "<span>x</span>"],
    ["another style", '<span style="color: red">x</span>'],
    ["an image", '<img src="https://x">'],
    ["an unclosed tag", "<p"],
  ])("refuses %s", (_name, html) => {
    expect(() => assertNoteHtmlAllowed(html)).toThrow();
  });

  it("accepts the citation node, its item, the line-through span and both link kinds", () => {
    const n = NODES[0] as CitationNode;
    expect(() =>
      assertNoteHtmlAllowed(
        `<p>${n.html} <span style="text-decoration: line-through">x</span> ` +
          `<a href="zotero://select/library/items/${B}" title="t">[1]</a> ` +
          '<a href="https://doi.org/10.1/x">d</a></p>',
      ),
    ).not.toThrow();
  });
});

describe("renderInline", () => {
  const cite = (n: number): string => `<C${n}>`;

  it("escapes HTML and keeps backslash escapes literal", () => {
    expect(renderInline('a < b & "c" \\*not em\\*', cite)).toBe(
      "a &lt; b &amp; &quot;c&quot; *not em*",
    );
  });

  it("does not treat an underscore inside a word as emphasis", () => {
    expect(renderInline("snake_case_name and _this_", cite)).toBe(
      "snake_case_name and <em>this</em>",
    );
  });

  it("shows a marker bound inside a code span as its number, as code", () => {
    expect(renderInline(`\`x ${CITE_OPEN}2${CITE_CLOSE}\``, cite)).toBe(
      "<code>x [2]</code>",
    );
  });
});

describe("citationPreviewText", () => {
  const en = { and: "and", etAl: "et al." };
  const year = { issued: { "date-parts": [["2024"]] } };

  it("takes the note editor's shape with the CSL locale's words", () => {
    expect(
      citationPreviewText({ author: [{ family: "Smith" }], ...year }, en),
    ).toBe("Smith, 2024");
    expect(
      citationPreviewText(
        { author: [{ family: "홍" }, { family: "Brown" }], ...year },
        en,
      ),
    ).toBe("홍 and Brown, 2024");
    expect(
      citationPreviewText(
        {
          author: [{ family: "Kim" }, { family: "Lee" }, { family: "Park" }],
          ...year,
        },
        { and: "와/과", etAl: "등" },
      ),
    ).toBe("Kim 등, 2024");
    // The words come from the terms given, never from a built-in English.
    expect(
      citationPreviewText(
        { author: [{ family: "홍" }, { family: "Brown" }], ...year },
        { and: "와/과", etAl: "등" },
      ),
    ).toBe("홍 와/과 Brown, 2024");
  });

  it("falls back to the literal name, then the quoted title, and omits a missing or 0000 year", () => {
    expect(citationPreviewText({ author: [{ literal: "WHO" }] }, en)).toBe(
      "WHO",
    );
    expect(citationPreviewText({ title: "Untitled" }, en)).toBe("“Untitled”");
    expect(
      citationPreviewText(
        { title: "T", issued: { "date-parts": [["0000"]] } },
        en,
      ),
    ).toBe("“T”");
    expect(
      citationPreviewText({ issued: { "date-parts": [[2021]] } }, en),
    ).toBe(", 2021");
  });
});

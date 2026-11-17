/**
 * `P4-T15` — the trend report's "Export as Markdown" (`docs/06` §14.3,
 * `docs/08` §6.3).
 *
 * Every report here is synthetic and written in this file. No network, no
 * model, no citeproc: the export reads the stored record only.
 *
 * **"An export has no `[[`" is scoped to text outside code fences**
 * (`plan/reports/P4-T10.md` finding 1; `docs/06` §14.3's note of 2026-10-27,
 * item 4): the main fixture holds no fence and is checked for no `[[` at
 * all; a second fixture holds a fenced marker, which stays as written.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { createLogger, type LogSink } from "../../../src/core/logger";
import type { Doi } from "../../../src/model/ids";
import type {
  BibliographyEntry,
  RetractedEntry,
  TrendReport,
} from "../../../src/model/trend";
import {
  DEFAULT_RETRACTED_HEADING,
  DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION,
  doiUrl,
  escapeMarkdownText,
  needsSemanticScholarAttribution,
  escapeReportProse,
  exportReportMarkdown,
  renderReportMarkdown,
  reportExportFileName,
  safeBaseName,
  type ReportFileWriter,
} from "../../../src/pipeline/trendReport/exportMarkdown";
import { reportFileWriter } from "../../../src/zotero/notes";
import { FakeZotero } from "../../setup/zotero-global";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const A = "AAAA1111";
const B = "BBBB2222";
const C = "CCCC3333";
const R = "RETR0001";

const doi = (d: string): Doi => d as Doi;

/** APA: the style prints the DOI's address itself, in capitals. */
const ENTRY_B: BibliographyEntry = {
  itemKey: B,
  index: 1,
  text:
    "Kim, J., & Lee, S. (2024). Polygenic scores in practice. Nature " +
    "Medicine, 30(2), 1–9. https://doi.org/10.1038/S41591-024-0001-X",
  doi: doi("10.1038/s41591-024-0001-x"),
};
/** IEEE: the style prints `doi:` and no address. */
const ENTRY_A: BibliographyEntry = {
  itemKey: A,
  index: 2,
  text: 'J. Park, "Risk models," Circulation, vol. 1, pp. 1–2, 2020, doi: 10.1161/circ.1.',
  doi: doi("10.1161/circ.1"),
};
/** No DOI, and a title that would be a marker and emphasis if unescaped. */
const ENTRY_C: BibliographyEntry = {
  itemKey: C,
  index: 3,
  text: "Choi, M. (2023). [[Odd]] title with *stars* and_underscores.",
  doi: undefined,
};
const RETRACTED: RetractedEntry = {
  itemKey: R,
  text: "Retracted, A. (2019). Withdrawn study. https://doi.org/10.5555/retr.1",
  doi: doi("10.5555/retr.1"),
};

const MARKDOWN = [
  "# Research Trends: Cardio / Risk",
  "_3 papers · 2020–2024 · generated 2026-10-27 by research_helper v0.0.2_",
  "",
  "## 1. Executive Summary",
  "",
  `- Scores improved discrimination [[${B}]] and replicated [[${A}]] [[${B}]].`,
  "",
  "## 10. Notable Papers",
  "",
  "| Paper | Year | Why it matters | Theme |",
  "| --- | --- | --- | --- |",
  `| [[${C}]] | 2024 | First external validation. | Risk |`,
  "",
  "## 11. Bibliography",
  "",
  "Kim, J. (2024). Whatever the scaffold wrote here is replaced.",
  "",
  "## Appendix A — Excluded from synthesis",
  "",
  "| Item | Reason |",
  "| --- | --- |",
  `| ${R} | retracted |`,
  "",
].join("\n");

/** Strings that may sit in the record but must never reach the file. */
const SENTINEL_KEY = "sk-ant-api03-SENTINELSENTINELSENTINELSENTINEL";
const SENTINEL_EMAIL = "owner.sentinel@example.org";

function report(overrides: Partial<TrendReport> = {}): TrendReport {
  return {
    id: "report-0001",
    libraryID: 1,
    collectionKey: "COLL0001",
    collectionName: "Cardio / Risk",
    title: "Research Trends: Cardio / Risk (2026-10-27)",
    language: "en",
    generatedAtEpochMs: Date.UTC(2026, 9, 27, 23, 30),
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
    sections: [
      {
        number: 1,
        heading: "1. Executive Summary",
        markdown: "",
        citedItemKeys: [B, A],
      },
      {
        number: 10,
        heading: "10. Notable Papers",
        markdown: "",
        citedItemKeys: [C],
      },
      {
        number: 11,
        heading: "11. Bibliography",
        markdown: "",
        citedItemKeys: [],
      },
    ],
    clustering: { themes: [], assignments: [] },
    bibliography: [ENTRY_C, ENTRY_A, ENTRY_B],
    retracted: [RETRACTED],
    excluded: [{ itemKey: R, reason: "retracted" }],
    summaryIds: ["summary-1"],
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
    audioScripts: { en: `script ${SENTINEL_EMAIL}` },
    providerId: "anthropic",
    prompts: [],
    usage: undefined,
    citedItemKeys: [B, A, C],
    warnings: [`warning ${SENTINEL_KEY}`, SENTINEL_EMAIL],
    ...overrides,
  };
}

const EXPECTED = [
  "# Research Trends: Cardio / Risk",
  "_3 papers · 2020–2024 · generated 2026-10-27 by research_helper v0.0.2_",
  "",
  "## 1. Executive Summary",
  "",
  "- Scores improved discrimination [1] and replicated [2] [1].",
  "",
  "## 10. Notable Papers",
  "",
  "| Paper | Year | Why it matters | Theme |",
  "| --- | --- | --- | --- |",
  "| [3] | 2024 | First external validation. | Risk |",
  "",
  "## 11. Bibliography",
  "",
  "[1] Kim, J., & Lee, S. (2024). Polygenic scores in practice. Nature " +
    "Medicine, 30(2), 1–9. <https://doi.org/10.1038/s41591-024-0001-x>",
  "",
  '[2] J. Park, "Risk models," Circulation, vol. 1, pp. 1–2, 2020, doi: ' +
    "10.1161/circ.1. <https://doi.org/10.1161/circ.1>",
  "",
  "[3] Choi, M. (2023). \\[\\[Odd\\]\\] title with \\*stars\\* and\\_underscores.",
  "",
  "### Retracted — not used in this report",
  "",
  "- Retracted, A. (2019). Withdrawn study. <https://doi.org/10.5555/retr.1>",
  "",
  "## Appendix A — Excluded from synthesis",
  "",
  "| Item | Reason |",
  "| --- | --- |",
  `| ${R} | retracted |`,
  "",
].join("\n");

/** The `[n]` numbers outside §11, in text order. */
function bodyNumbers(markdown: string): number[] {
  const body = markdown.split("## 11. Bibliography")[0] ?? "";
  return [...body.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

function firstAppearances(numbers: readonly number[]): number[] {
  return numbers.filter((n, i) => numbers.indexOf(n) === i);
}

function capturingLogger(): {
  readonly logger: ReturnType<typeof createLogger>;
  readonly lines: string[];
} {
  const lines: string[] = [];
  const sink: LogSink = { write: (line) => lines.push(line) };
  return {
    lines,
    logger: createLogger({ sink, clock: createManualClock(), level: "debug" }),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("renderReportMarkdown", () => {
  it("renders the fixture report exactly", () => {
    expect(renderReportMarkdown(report())).toBe(EXPECTED);
  });

  it("leaves no [[ anywhere when the report holds no code fence", () => {
    expect(MARKDOWN).not.toContain("```");
    expect(renderReportMarkdown(report())).not.toContain("[[");
  });

  it("numbers markers in order of first appearance, matching the bibliography", () => {
    const numbers = bodyNumbers(renderReportMarkdown(report()));
    expect(numbers).toEqual([1, 2, 1, 3]);
    expect(firstAppearances(numbers)).toEqual([1, 2, 3]);
  });

  it("writes exactly one doi.org link per DOI and none for an entry without one", () => {
    const out = renderReportMarkdown(report());
    for (const d of [ENTRY_B.doi, ENTRY_A.doi, RETRACTED.doi]) {
      const link = `<${doiUrl(d ?? "")}>`;
      expect(out.split(link).length - 1).toBe(1);
    }
    // The style's own printed address became the link: no second copy.
    expect(out).not.toMatch(/doi\.org\/10\.1038\/S41591/);
    expect(out.match(/doi\.org\//g)).toHaveLength(3);
    const entryC = out.split("\n").find((l) => l.startsWith("[3] "));
    expect(entryC).not.toContain("doi.org");
  });

  it("writes no zotero:// link", () => {
    expect(renderReportMarkdown(report())).not.toContain("zotero://");
  });

  it("keeps a fenced marker as written and leaves no [[ outside fences", () => {
    const fence = ["```text", "[[ZZZZ9999]] is how the model cites", "```"];
    const fenced = MARKDOWN.replace(
      "## 10. Notable Papers",
      [...fence, "", "## 10. Notable Papers"].join("\n"),
    );
    const out = renderReportMarkdown(report({ markdown: fenced }));
    expect(out).toContain(fence.join("\n"));
    expect(out.replace(/```[\s\S]*?```/g, "")).not.toContain("[[");
    expect(firstAppearances(bodyNumbers(out))).toEqual([1, 2, 3]);
  });

  it("leaves the retracted list out when the run kept none (exclude_entirely)", () => {
    const out = renderReportMarkdown(report({ retracted: [] }));
    expect(out).not.toContain(DEFAULT_RETRACTED_HEADING);
    expect(out).not.toContain("### ");
    expect(out).toContain(
      "[3] Choi, M. (2023). \\[\\[Odd\\]\\] title with \\*stars\\* and\\_underscores.\n\n## Appendix A",
    );
  });

  it("takes the retracted list's heading from the caller", () => {
    const out = renderReportMarkdown(report(), {
      retractedHeading: "LABEL FROM CALLER",
    });
    expect(out).toContain("### LABEL FROM CALLER\n");
    expect(out).not.toContain(DEFAULT_RETRACTED_HEADING);
  });

  it("finds §11 when the section's heading carries its hashes, and at the end of the text", () => {
    const atEnd = MARKDOWN.slice(0, MARKDOWN.indexOf("## Appendix A"));
    const sections = report().sections.map((s) =>
      s.number === 11 ? { ...s, heading: "## 11. Bibliography" } : s,
    );
    const out = renderReportMarkdown(
      report({ markdown: atEnd, sections, retracted: [] }),
    );
    expect(out.endsWith("and\\_underscores.\n")).toBe(true);
    expect(out).not.toContain("Whatever the scaffold wrote");
  });

  it("takes §11 only from a level-2 heading, not a deeper one with the same text", () => {
    const withSub = MARKDOWN.replace(
      "## 10. Notable Papers",
      "### 11. Bibliography\n\nA sub-heading the model wrote.\n\n## 10. Notable Papers",
    );
    const out = renderReportMarkdown(report({ markdown: withSub }));
    expect(out).toContain(
      "### 11. Bibliography\n\nA sub-heading the model wrote.",
    );
    expect(out).toContain("## 11. Bibliography\n\n[1] Kim, J.");
  });

  it("links a printed http://dx.doi.org address in place, keeping the punctuation after it", () => {
    const printed: BibliographyEntry = {
      ...ENTRY_B,
      text: "Kim, J. (2024). Scores. http://dx.doi.org/10.1038/s41591-024-0001-x. Epub.",
    };
    const out = renderReportMarkdown(
      report({ bibliography: [printed, ENTRY_A, ENTRY_C] }),
    );
    expect(out).toContain(
      "[1] Kim, J. (2024). Scores. <https://doi.org/10.1038/s41591-024-0001-x>. Epub.\n",
    );
    expect(out.match(/doi\.org\/10\.1038/g)).toHaveLength(1);
  });

  it("puts nothing the export does not read into the file", () => {
    const out = renderReportMarkdown(report());
    expect(out).not.toContain(SENTINEL_KEY);
    expect(out).not.toContain(SENTINEL_EMAIL);
    expect(out).not.toContain("report-0001");
  });

  describe("refuses a record it cannot number truthfully", () => {
    const refusals: [string, Partial<TrendReport>][] = [
      [
        "no §11 section",
        { sections: report().sections.filter((s) => s.number !== 11) },
      ],
      [
        "no §11 heading in the text",
        { markdown: MARKDOWN.replace("## 11. Bibliography", "## Eleven") },
      ],
      [
        "§11's heading twice",
        { markdown: `${MARKDOWN}\n## 11. Bibliography\n` },
      ],
      [
        "the bibliography in another order",
        {
          bibliography: [
            { ...ENTRY_B, index: 2 },
            { ...ENTRY_A, index: 1 },
            ENTRY_C,
          ],
        },
      ],
      [
        "a cited item missing from the bibliography",
        { bibliography: [ENTRY_B, ENTRY_A] },
      ],
      [
        "an entry nothing cites",
        {
          bibliography: [
            ENTRY_B,
            ENTRY_A,
            ENTRY_C,
            { itemKey: "DDDD4444", index: 4, text: "Uncited.", doi: undefined },
          ],
        },
      ],
      [
        "indices that are not 1…n",
        { bibliography: [ENTRY_B, ENTRY_A, { ...ENTRY_C, index: 4 }] },
      ],
      [
        "a malformed marker outside a fence",
        {
          markdown: MARKDOWN.replace(
            "First external",
            "[[abc]] First external",
          ),
        },
      ],
    ];
    it.each(refusals)("%s", (_name, overrides) => {
      expect(() => renderReportMarkdown(report(overrides))).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Escaping and DOI addresses
// ---------------------------------------------------------------------------

describe("escapeMarkdownText", () => {
  it("escapes markers, links, emphasis, code and HTML", () => {
    expect(escapeMarkdownText("[[KEY]] *a* _b_ `c` <d> ~~e~~ \\")).toBe(
      "\\[\\[KEY\\]\\] \\*a\\* \\_b\\_ \\`c\\` \\<d\\> \\~\\~e\\~\\~ \\\\",
    );
  });

  it("escapes a leading heading, list sign or list number, and joins lines", () => {
    expect(escapeMarkdownText("# Title")).toBe("\\# Title");
    expect(escapeMarkdownText("- dash")).toBe("\\- dash");
    expect(escapeMarkdownText("+ plus")).toBe("\\+ plus");
    expect(escapeMarkdownText("1000. Genomes")).toBe("1000\\. Genomes");
    expect(escapeMarkdownText("12) item")).toBe("12\\) item");
    expect(escapeMarkdownText("1000 Genomes")).toBe("1000 Genomes");
    expect(escapeMarkdownText("one\r\n  two\nthree")).toBe("one two three");
  });
});

describe("doiUrl", () => {
  it("percent-encodes what a URL or an autolink cannot carry", () => {
    expect(
      doiUrl("10.1002/(sici)1097-4636(199603)31:3<321::aid-jbm4>3.0.co;2-n"),
    ).toBe(
      "https://doi.org/10.1002/(sici)1097-4636(199603)31:3%3C321::aid-jbm4%3E3.0.co;2-n",
    );
    expect(doiUrl("10.1234/a#b?c%d [e]")).toBe(
      "https://doi.org/10.1234/a%23b%3Fc%25d%20%5Be%5D",
    );
    expect(doiUrl("10.1234/한")).toBe("https://doi.org/10.1234/%ED%95%9C");
  });

  it("links an entry whose DOI needs encoding once, appended", () => {
    const d = doi(
      "10.1002/(sici)1097-4636(199603)31:3<321::aid-jbm4>3.0.co;2-n",
    );
    const out = renderReportMarkdown(
      report({
        bibliography: [
          { ...ENTRY_B, text: "Old, A. (1996). T.", doi: d },
          ENTRY_A,
          ENTRY_C,
        ],
      }),
    );
    expect(out).toContain(`[1] Old, A. (1996). T. <${doiUrl(d)}>\n`);
    expect(out).not.toContain("[[");
  });
});

// ---------------------------------------------------------------------------
// The filename — `docs/08` §6.3
// ---------------------------------------------------------------------------

describe("safeBaseName and reportExportFileName", () => {
  it("names the language only when it is given, for a two-report run (docs/08 §6.3)", () => {
    const at = Date.UTC(2026, 9, 27);
    expect(reportExportFileName("A", at)).toBe("A — trends 2026-10-27.md");
    expect(reportExportFileName("A", at, "ko")).toBe(
      "A — trends 2026-10-27 (ko).md",
    );
    expect(reportExportFileName("A", at, "en")).toBe(
      "A — trends 2026-10-27 (en).md",
    );
  });

  it("gives a safe filename for a collection name with / and :", () => {
    const name = reportExportFileName(
      "Cardio / Risk: 2024",
      Date.UTC(2026, 9, 27),
    );
    expect(name).toBe("Cardio - Risk- 2024 — trends 2026-10-27.md");
    // eslint-disable-next-line no-control-regex -- the control range is the point
    expect(name).not.toMatch(/[\\/:*?"<>|\x00-\x1f]/);
  });

  it("replaces every refused character and control character", () => {
    expect(safeBaseName('a\\b/c:d*e?f"g<h>i|j\u0001k\u001fl')).toBe(
      "a-b-c-d-e-f-g-h-i-j-k-l",
    );
  });

  it("collapses whitespace, falls back to report, and caps at 80 code points", () => {
    expect(safeBaseName("  many    spaces  ")).toBe("many spaces");
    // A tab or a line break is a control character: `-` first, as the sketch orders it.
    expect(safeBaseName("a\tb\nc")).toBe("a-b-c");
    expect(safeBaseName("")).toBe("report");
    expect(safeBaseName("   ")).toBe("report");
    expect(safeBaseName(undefined)).toBe("report");
    const emoji = "😀".repeat(100);
    const capped = safeBaseName(emoji);
    expect(Array.from(capped)).toHaveLength(80);
    expect(capped).toBe("😀".repeat(80));
    expect(safeBaseName(`${"x".repeat(79)} tail`)).toBe("x".repeat(79));
  });

  it("dates the name by the report's generation, in UTC", () => {
    expect(
      reportExportFileName("연구 모음", Date.UTC(2026, 0, 2, 23, 59)),
    ).toBe("연구 모음 — trends 2026-01-02.md");
  });
});

// ---------------------------------------------------------------------------
// The export and the writer
// ---------------------------------------------------------------------------

const PATH = "C:\\Users\\private-account\\Documents\\trends.md";

describe("exportReportMarkdown", () => {
  it("writes the rendered report to the chosen path and logs no path", async () => {
    const writes: [string, string][] = [];
    const files: ReportFileWriter = {
      writeTextFile: async (path, text) => void writes.push([path, text]),
    };
    const { logger, lines } = capturingLogger();
    await expect(
      exportReportMarkdown(PATH, report(), { files, logger }),
    ).resolves.toBe("written");
    expect(writes).toEqual([[PATH, EXPECTED]]);
    expect(lines.join("\n")).toContain("report-0001");
    expect(lines.join("\n")).not.toContain("private-account");
  });

  it("refuses an empty path and writes nothing", async () => {
    const writeTextFile = vi.fn(async () => undefined);
    const { logger } = capturingLogger();
    await expect(
      exportReportMarkdown("", report(), { files: { writeTextFile }, logger }),
    ).resolves.toBe("no-path");
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("refuses a record it cannot render and writes nothing", async () => {
    const writeTextFile = vi.fn(async () => undefined);
    const { logger, lines } = capturingLogger();
    await expect(
      exportReportMarkdown(PATH, report({ bibliography: [] }), {
        files: { writeTextFile },
        logger,
      }),
    ).resolves.toBe("invalid-report");
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain("private-account");
  });

  it("reports a failed write without logging the path or the error", async () => {
    const files: ReportFileWriter = {
      writeTextFile: () =>
        Promise.reject(new Error(`cannot open ${PATH} for writing`)),
    };
    const { logger, lines } = capturingLogger();
    await expect(
      exportReportMarkdown(PATH, report(), { files, logger }),
    ).resolves.toBe("failed");
    const log = lines.join("\n");
    expect(log).toContain("report-0001");
    expect(log).not.toContain("private-account");
    expect(log).not.toContain("cannot open");
  });

  it("passes the caller's labels through", async () => {
    let written = "";
    const files: ReportFileWriter = {
      writeTextFile: async (_path, text) => void (written = text),
    };
    const { logger } = capturingLogger();
    await exportReportMarkdown(PATH, report(), {
      files,
      logger,
      labels: { retractedHeading: "LABEL FROM CALLER" },
    });
    expect(written).toContain("### LABEL FROM CALLER\n");
  });
});

describe("reportFileWriter", () => {
  afterEach(() => {
    delete (FakeZotero as { File?: unknown }).File;
  });

  it("writes through Zotero.File.putContentsAsync(path, text), charset left at UTF-8", async () => {
    const putContentsAsync = vi.fn(async () => undefined);
    (FakeZotero as { File?: unknown }).File = { putContentsAsync };
    await reportFileWriter().writeTextFile(PATH, "# 한국어 보고서\n");
    expect(putContentsAsync).toHaveBeenCalledTimes(1);
    expect(putContentsAsync).toHaveBeenCalledWith(PATH, "# 한국어 보고서\n");
  });
});

// ---------------------------------------------------------------------------
// The model's prose — owner, 2026-10-27, plan/00 §6 item 296(c), (d)
// (added by P4-T13; docs/06 §14.3's note, item 8)
// ---------------------------------------------------------------------------

describe("escapeReportProse", () => {
  it("shows raw HTML as text: every < is escaped", () => {
    expect(
      escapeReportProse('<script>alert(1)</script> <b onclick="x">b</b>'),
    ).toBe('\\<script>alert(1)\\</script> \\<b onclick="x">b\\</b>');
  });

  it("lets no zotero: address become a link, in any form", () => {
    expect(
      escapeReportProse("[the paper](zotero://select/library/items/ABCD1234)"),
    ).toBe("[the paper]\\(zotero://select/library/items/ABCD1234)");
    expect(escapeReportProse("[x]( <ZOTERO://select/items/1>)")).toBe(
      "[x]\\( \\<ZOTERO://select/items/1>)",
    );
    expect(escapeReportProse("![img](zotero://open-pdf/x)")).toBe(
      "![img]\\(zotero://open-pdf/x)",
    );
    expect(escapeReportProse("<zotero://select/items/1>")).toBe(
      "\\<zotero://select/items/1>",
    );
    expect(escapeReportProse("[ref]: zotero://select/items/1")).toBe(
      "\\[ref]: zotero://select/items/1",
    );
  });

  it("leaves an https link and an ordinary reference definition as they are", () => {
    expect(escapeReportProse("[site](https://example.org)")).toBe(
      "[site](https://example.org)",
    );
    expect(escapeReportProse("[site]: https://example.org")).toBe(
      "[site]: https://example.org",
    );
  });

  it("escapes a definition with an all-digit label, which would link a bare [n]", () => {
    expect(escapeReportProse("[2]: https://evil.example")).toBe(
      "\\[2]: https://evil.example",
    );
  });

  it("escapes the bracket after a marker followed directly by ( or [", () => {
    expect(
      escapeReportProse(
        "see [[AAAA1111]](https://x.org) and [[BBBB2222]][ref]",
      ),
    ).toBe("see [[AAAA1111]]\\(https://x.org) and [[BBBB2222]]\\[ref]");
    expect(escapeReportProse("[[AAAA1111]] (2024)")).toBe(
      "[[AAAA1111]] (2024)",
    );
  });

  it("leaves code fences and inline code spans exactly as written", () => {
    const fenced = [
      "```html",
      "<b>[x](zotero://select/1)</b> [[AAAA1111]](y)",
      "```",
    ].join("\n");
    expect(escapeReportProse(fenced)).toBe(fenced);
    expect(escapeReportProse("use `<b>` and ``a ` <i>`` here <u>")).toBe(
      "use `<b>` and ``a ` <i>`` here \\<u>",
    );
    expect(escapeReportProse("an `unclosed <span")).toBe(
      "an `unclosed \\<span",
    );
  });
});

describe("renderReportMarkdown — the model's prose (item 296(c), (d))", () => {
  const prose = MARKDOWN.replace(
    `- Scores improved discrimination [[${B}]] and replicated [[${A}]] [[${B}]].`,
    `- Scores improved <em>discrimination</em> [[${B}]](https://evil.example) and ` +
      `replicated [[${A}]] [[${B}]]; [paper](zotero://select/library/items/${A}).`,
  );
  const out = renderReportMarkdown(report({ markdown: prose }));

  it("keeps a marker followed by (…) a plain [n], the bracketed text visible", () => {
    expect(out).toContain("[1]\\(https://evil.example)");
    expect(out).not.toMatch(/\[\d+\]\(/);
  });

  it("writes no zotero:// link and shows raw HTML as text", () => {
    expect(out).toContain(`[paper]\\(zotero://select/library/items/${A})`);
    expect(out).not.toMatch(/\]\(zotero:/i);
    expect(out).toContain("\\<em>discrimination\\</em>");
  });

  it("still numbers every marker in first-appearance order", () => {
    expect(firstAppearances(bodyNumbers(out))).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// The Semantic Scholar line (P7-T35; owner, plan/00 §6 item 395(c))
// ---------------------------------------------------------------------------

describe("renderReportMarkdown — the Semantic Scholar line (P7-T35, item 395(c))", () => {
  const fromS2 = (entry: BibliographyEntry): BibliographyEntry => ({
    ...entry,
    semanticScholar: true,
  });

  it("is the owner's sentence", () => {
    expect(DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION).toBe(
      "Some records: Semantic Scholar, Allen Institute for AI.",
    );
  });

  it("is absent when no cited record came from Semantic Scholar", () => {
    const out = renderReportMarkdown(report());
    expect(out).toBe(EXPECTED);
    expect(out).not.toContain("Semantic Scholar");
    expect(needsSemanticScholarAttribution(report().bibliography)).toBe(false);
  });

  it("is printed once, under the numbered entries and before the retracted list", () => {
    const out = renderReportMarkdown(
      report({ bibliography: [ENTRY_C, fromS2(ENTRY_A), ENTRY_B] }),
    );
    expect(out.split(DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION)).toHaveLength(2);
    expect(out).toContain(
      "[3] Choi, M. (2023). \\[\\[Odd\\]\\] title with \\*stars\\* and\\_underscores.\n\n" +
        DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION +
        "\n\n### Retracted — not used in this report",
    );
    // Everything else is the fixture's output.
    expect(out.replace(`${DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION}\n\n`, "")).toBe(
      EXPECTED,
    );
  });

  it("closes §11 when the run kept no retracted entry", () => {
    const out = renderReportMarkdown(
      report({
        bibliography: [fromS2(ENTRY_C), ENTRY_A, ENTRY_B],
        retracted: [],
      }),
    );
    expect(out).toContain(
      `and\\_underscores.\n\n${DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION}\n\n## Appendix A`,
    );
  });

  it("does not count a retracted record, which the report does not cite", () => {
    expect(needsSemanticScholarAttribution([ENTRY_A, ENTRY_B, ENTRY_C])).toBe(
      false,
    );
    expect(needsSemanticScholarAttribution([])).toBe(false);
    expect(
      needsSemanticScholarAttribution([
        ENTRY_A,
        { ...ENTRY_B, semanticScholar: false },
      ]),
    ).toBe(false);
    expect(needsSemanticScholarAttribution([ENTRY_A, fromS2(ENTRY_B)])).toBe(
      true,
    );
  });

  it("takes the line from the caller, escaped", () => {
    const out = renderReportMarkdown(
      report({ bibliography: [ENTRY_C, ENTRY_A, fromS2(ENTRY_B)] }),
      { semanticScholarAttribution: "LINE *FROM* CALLER" },
    );
    expect(out).toContain("\n\nLINE \\*FROM\\* CALLER\n\n### ");
    expect(out).not.toContain(DEFAULT_SEMANTIC_SCHOLAR_ATTRIBUTION);
  });
});

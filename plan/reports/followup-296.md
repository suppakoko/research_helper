VERDICT: Done. All four parts of item 296 are built and every check passes. Documents were written first, each under a dated "Decided 2026-10-27 (owner, plan/00 §6 item 296(x))" note.
- (a) P4-T13 is finished as option (a): Notable Papers and the Bibliography carry Zotero citation nodes, and the stored node text is made with the `en-US` CSL locale.
- (b) Notes are found by the stored note key and the tag, never by the marker comment. This is recorded in docs; no lookup code was built.
- (c) and (d) are in the Markdown export: raw HTML shows as text, no `zotero:` address becomes a link, and a marker followed by "(…)" stays a plain `[n]`.
- The P1-T44 badge failure did not reproduce in the three new runs.

Card State stays TODO. Nothing committed.

FILES CHANGED WITH DECLARATION NAMES (this continuation only)
- **created `src/pipeline/trendReport/noteHtml.ts`**
  - Exports: `renderReportNote`, `renderReportNoteHtml`, `renderInline`, `assertNoteHtmlAllowed`, `ReportNoteDeps`, `ReportNoteLabels`.
  - Private: `ALLOWED`, `TAG_RE`, `ATTR_RE`, `CITE_OPEN`, `CITE_CLOSE`, `CITE_RE`, `HOLD_OPEN`, `HOLD_CLOSE`, `HOLD_RE`, `RESERVED_RE`, `REPLACEMENT`, `holdCodeSpans`, `renderBlocks`, `renderTable`, `itemOf`, `splitRow`, `isTableStart`, `startsBlock`, `dedent`, `entryHtml`, `bibliographyHtml`.
  - Rule 10: nothing calls it yet. The caller is `trendReportPipeline.ts` (`P4-T18`), which calls `renderReportNote(report, { port: zoteroBibliographyPort, request })` and hands the HTML to `writeReportNote` (`P4-T14`). Nothing constructs it (pure functions plus one port).
- **created `test/unit/pipeline/trendNoteHtml.test.ts`**: 42 tests.
  - Every construct in docs/06 §14.1, plus the anchors, nodes, bibliography and retracted list.
  - The hostile cases: `<script>`, `onclick`/`onerror`, `javascript:`, `data:` and `zotero:` links, a model-written `<div>`, `<span class="citation">` or comment, and a marker followed by "(…)".
  - The refusals (missing or out-of-order section, bibliography order mismatch, missing node), plus `assertNoteHtmlAllowed`, `renderInline` and `citationPreviewText`.
- **modified `src/zotero/bibliography.ts`**
  - `citationNodes(itemKeys, request: BibliographyRequest)` replaces `(libraryID, itemKeys)`.
  - New `citationPreviewText` and `CitationTerms`; `CitationNode` gains `selectUri` and `text`.
  - Private: `nameOf`, `citationTerms` (uses `engine.getTerm("and")` and `getTerm("et-al")`), `selectUriOf`. The engine interface gains `getTerm`. `displayCopy` and `formatCitation` are no longer used.
  - Header comment updated.
- **modified `src/pipeline/trendReport/exportMarkdown.ts`** (P4-T15's file)
  - New `escapeReportProse`, `sectionRange`, `headingText` (now exported), `printedDoiAddress`.
  - Private: `ZOTERO_LINK_RE`, `MARKER_THEN_BRACKET_RE`, `RISKY_DEFINITION_RE`, `escapeProseSegment`, `outsideCodeSpans`.
  - `renderReportMarkdown` now runs `escapeReportProse` before binding and uses `sectionRange`; `entryWithDoiLink` uses `printedDoiAddress`.
- **modified `src/pipeline/trendReport/citations.ts`**: `fencedRanges` is exported, so the note renderer and the export use the same fence rule as the marker binder.
- **modified `src/zotero/itemMapper.ts`**: comment on `overflowNoteHtml` (item 296(b)).
- **modified `test/unit/pipeline/trendExport.test.ts`**: import of `escapeReportProse`; new blocks "escapeReportProse" (6 tests) and "renderReportMarkdown — the model's prose (item 296(c), (d))" (3 tests).
- **modified `test/integration/zotero/bibliography.spec.ts`**: its two `citationNodes` calls use the new signature. It now asserts the `en-US` node texts and `selectUri`, and logs the `ko-KR` texts.
- **modified `test/integration/zotero/reportNoteHtml.spec.ts`**: new signature, header updated, and a fourth test. That test renders a report through `renderReportNote` with the real port, checks that `setNote` returns it byte for byte, and opens it in the editor: 4 nodes shown, anchors and title kept, raw HTML shown as text, not saved on opening.

SHARED-FILE EDITS QUOTED (each anchor re-read before an exact-string edit)
- **docs/01 §5.11, my measurement note.** The closing "Open for the owner…" sentence is struck through and followed by:
  "**Decided 2026-10-27 (owner, `plan/00` §6 item 296(a)):** Notable Papers and the Bibliography keep Zotero citation nodes (D-06-7's live citations), and the owner accepts (1)–(3). Item 294(b) is narrowed to **the stored HTML**: the plugin writes each node's text with the bibliography's CSL locale (`en-US`, item 294(a)); what the note editor shows, and what it saves after its first save, is Zotero's."
- **docs/01 §5.11, the "Decided the same day (item 294(b))" sentence** gains: "*(Narrowed 2026-10-27, owner, `plan/00` §6 item 296(a): the editor does rewrite it — note above — so this holds for the stored HTML only.)*"
- **docs/01 §5.11, the "Citation nodes" as-built bullet.** "the visible text is `formatCitation`'s, computed from a copy whose names and title are HTML-escaped" is struck through, and this is added:
  "**Changed 2026-10-27 (`P4-T13`; owner, `plan/00` §6 item 296(a)):** the stored visible text is the plugin's (`citationPreviewText`), in the note editor's own shape — "Family, year", "A and B, year", "A et al., year", the quoted title when there is no author — with "and" and "et al." taken from the CSL engine of the request's style and locale (`getTerm("and")`, `getTerm("et-al")`), and HTML-escaped as a whole. `citationNodes` therefore takes the same `BibliographyRequest` as the bibliography, and each node also carries that text (`CitationNode.text`, for an inline anchor's `title`) and its `zotero://select` address (`CitationNode.selectUri`, `06-…` §10.2 (a))."
  The measurement under DOC NOTES item 1 follows it.
- **docs/06 §14.1, my measured note.** Its last sentence is struck through and followed by:
  "**Decided 2026-10-27 (owner, `plan/00` §6 item 296(a)):** they keep real citation nodes (D-06-7), and the owner accepts that the editor draws and, from its first save, stores the nodes' text in Zotero's interface language; the plugin's own text, made with the bibliography's `en-US` CSL locale, holds in the stored HTML until then. The renderer therefore relies on nothing outside the measured schema: no inline styles, no class but `citation` and `citation-item`, no comment."
- **docs/06 §14.1, new note after it.** Heading: "Decided 2026-10-27 (`P4-T13`; `renderReportNote`, `renderReportNoteHtml`, `renderInline` and `assertNoteHtmlAllowed` …)". Eight points:
  1. Construct forms: tables with no style, `pre` with no inner `code`, `<p>` inside list items, paragraph lines joined by a space, ordered lists start at 1.
  2. Only `http(s)` links the model wrote become links; other schemes and images stay as text.
  3. Everything is escaped, and the output must pass `assertNoteHtmlAllowed`, or nothing is saved.
  4. Body markers become `zotero://select` anchors titled with the node text. The first cell of a Notable Papers row gets a citation node. §11 becomes `[n] <node> <entry>` with one DOI link, then the retracted list under an `<h3>`. A marker followed by "(…)" stays an anchor.
  5. The eleven `## ` headings must each appear once and in order, and the cited order must match the bibliography's.
  6. The wrapper carries one payload per entry, in `[n]` order.
  7. The node text comes from `citationNodes`.
  8. The marker comment is P4-T14's, as information only.
- **docs/06 §14.3, P4-T15's first note.** "(the model's prose is passed through unchanged; see the note below, item 7)" is struck through, and this is added: ", and lets none in the model's prose become a link (owner, 2026-10-27, `plan/00` §6 item 296(c); the note below, item 8)."
- **docs/06 §14.3, P4-T15's second note.** "The model's prose is otherwise passed through unchanged." is struck through, and this is added:
  "(8) **Decided 2026-10-27 (owner, `plan/00` §6 item 296(c), (d)); built by `P4-T13`:** the model's prose is no longer passed through unchanged. Outside code fences and inline code spans — which stay exactly as written (`P4-T10`'s rule): every `<` is backslash-escaped, so raw HTML and autolinks show as text; an inline link or image whose destination is a `zotero:` address keeps its text but loses its link (`](` becomes `]\(`), and a link reference definition pointing at a `zotero:` address, or with an all-digit label, is escaped so it defines nothing; and a marker followed directly by `(` or `[` is written `[n]\(` / `[n]\[`, so `[n]` stays a plain number and the bracketed text after it stays visible as text. The rest of the prose is unchanged. `escapeReportProse` in `src/pipeline/trendReport/exportMarkdown.ts`."
- **docs/07 §6.4.** "The plugin finds its own note by scanning child notes for this marker, so the note can be freely renamed or reordered by the user." is struck through, and this is added:
  "*Decided 2026-10-27 (owner, `plan/00` §6 item 296(b)): the plugin finds its note by the note item key it stored and by the note's tag, never by this marker, because Zotero's note editor drops every HTML comment the first time it saves a note (`01-zotero-plugin-platform.md` §5.7, measured by `P4-T13`). The comment is still written, as information only; renaming or reordering the note still loses nothing, because neither the key nor the tag depends on the title or position.*"
- **docs/07 §6.5**, after the 2026-10-26 correction note:
  "*Decided 2026-10-27 (owner, `plan/00` §6 item 296(b)): the report note is found by its stored note item key (`TrendReport.zoteroNoteKey`) and its tag, never by the marker, which Zotero's note editor drops on its first save (`01-zotero-plugin-platform.md` §5.7); the marker stays as information only. The same holds for the overflow note of §6.3 (`overflowNoteHtml` in `src/zotero/itemMapper.ts`, marker `<!-- rh:extra v=1 … -->`). No lookup by any marker is built.*"
- **docs/07 storage table.** The `StoredSummary` (presentation) key column changes from "marker comment + tag" to "stored note key + tag (the marker comment is information only; `plan/00` §6 item 296(b), 2026-10-27)".
- **plan/07, P4-T13 card, the 294(b) note** gains: "*Narrowed 2026-10-27 (owner, `plan/00` §6 item 296(a)): the note editor does rewrite the text (`docs/01` §5.11, measured by this card), so 294(b) holds for **the stored HTML** only; Notable Papers and the Bibliography keep citation nodes, and what the editor shows is Zotero's.*"
- **plan/07, P4-T13 card, Files.** A "*Noted 2026-10-27 (`P4-T13`, rule 10)*" note on the `noteHtml.ts` row. It names the caller and that nothing constructs the module. It also lists the files outside the card that item 296 put in the work: `bibliography.ts`, `bibliography.spec.ts`, `exportMarkdown.ts`, `trendExport.test.ts`, `citations.ts` and `itemMapper.ts`.
- **plan/07, P4-T21 note** gains: "*Narrowed 2026-10-27 (owner, `plan/00` §6 item 296(a)): in the stored HTML only — Zotero's note editor draws a node's text in its own interface language and saves that text on its first save (`docs/01` §5.11).*"
- **plan/07, P4-T14 Done-when**, under "The note carries the tag and the marker…":
  "*Decided 2026-10-27 (owner, `plan/00` §6 item 296(b)): the note is found by the note item key the run stores (`TrendReport.zoteroNoteKey`) and by the tag `research_helper/trend-report`, never by the marker comment, which Zotero's note editor drops on its first save (`docs/01` §5.7, measured by `P4-T13`). The comment is still written, as information only; no lookup by it is built.*"
- **plan/04, P3-T29 card**, new block at the end of Notes:
  "> **Decided 2026-10-27 (owner, `plan/00` §6 item 296(b)):** the summary note is found by the note item key the plugin stores and by its tag (step 5), **never by the `<!-- rh:summary … -->` marker comment** of `docs/07` §6.4, because Zotero's note editor drops every HTML comment the first time it saves a note (`docs/01` §5.7, measured by `P4-T13`). The comment is still written, as information only. The removal command (step 6) already selects by tag."
- **plan/00**: not edited by hand; `index:derive` produced identical content.

DOC NOTES ADDED (measurements of this continuation)
1. docs/01 §5.11, inside the "Changed" bullet: "**Measured 2026-10-27 (`P4-T13`; `test/integration/zotero/bibliography.spec.ts`, three full runs):** `getTerm` exists on the engine in 10.0.3; with APA, `en-US` gave "Smith, 2022", "홍 and Brown, 2023", "Kim et al., 2024" (asserted), and `ko-KR` gave "홍 와/과 Brown, 2023" and "Kim 기타, 2024" (logged only; the CSL `ko-KR` "et-al" term is "기타", where the note editor's Korean is "등"). `selectUri` for an item in the user's library was `zotero://select/library/items/<key>`; a group library's form is unmeasured."
2. From `reportNoteHtml.spec.ts`, logged in the run output only and not written into the docs: the editor showed the shipped renderer's output as 4 nodes, `["(Smith, 2022)","(Kim et al., 2024)","(홍 and Brown, 2023)","(Smith, 2022)"]`, under `en-US`, and it kept the anchors' `href` and `title`. Opening the note did not save it.

NEW STRINGS: none. No `.ftl` file, `keys.ts` or `KO_PENDING_REVIEW` change. The retracted-list heading reuses `DEFAULT_RETRACTED_HEADING`, and a Korean caller passes its own label.

RUNS
- `npm run typecheck`, `npm run lint:check` (eslint, and "All matched files use Prettier code style!") and `npx eslint .`: each exit 0.
- `npm run test`: exit 0. Unit tests: 90 files, 4313 tests. Contract tests: 2 files, 40 tests.
- `npm run build`: exit 0. The combined md5 of `typings/*.d.ts` was 20374829394b73d8c95cd28f5c727b15 before and after.
- `npm run index:derive`, run twice: plan/00 md5 stayed 580278ff657c04dfdb12a0281b397029 before and after both runs. Header: "182 tasks, 112 DONE, 70 TODO".
- `NODE_USE_SYSTEM_CA=1 npm run test:integration -- --exit-on-finish`, three runs. Each pre-flight found 0 `MUTANT` lines and 0 `zotero.exe` on `.scaffold\test\profile`; I killed nothing.
  - Run 1: 208 of 208 passed, 203 s.
  - Run 2: 208 of 208 passed, 204 s.
  - Run 3: 208 of 208 passed, 202 s.
  - The count is 207 from before plus my new renderer test.
  - Speed (P1-T23): startup delta 23, 15 and 18 ms against a 200 ms budget; 100 items appeared after 419, 421 and 433 ms.
  - Logs: `C:\Users\<user>\AppData\Local\Temp\claude\D--KIST-projects\8cdd8c5e-b39c-4ecd-b76d-7a4f11ecfce6\scratchpad\cont1.log`, `cont2.log` and `cont3.log`.
- docs/01 was edited after the runs (the measured-terms sentence only).
- Mutants: 15, each marked `/* MUTANT id */`, run against the two unit-test files, and restored by copy. Every restore was verified by md5; `grep -rn MUTANT src test addon typings scripts` is empty at the end.
  - Export mutants, all killed:
    - E1, `<` not escaped: 4 failed.
    - E2, `zotero:` links kept: 2 failed.
    - E3, marker followed by a bracket not escaped: 2 failed.
    - E4, risky reference definitions kept: 2 failed.
    - E5, escaping applied inside code spans: 1 failed.
    - E6, escaping applied inside fences: 1 failed.
  - Note-renderer mutants:
    - N3, a Notable Papers cell gets an anchor instead of a node: 1 failed.
    - N4, the whitelist check disabled: 10 failed.
    - N5, fences not recognised: 2 failed.
    - N6, private-use characters from the model not replaced: 1 failed.
    - N7, anchor `title` not escaped: 1 failed.
    - N8, image syntax linked: 1 failed.
    - N1 (model text not escaped) and N2 (any link scheme allowed): the test file fails to load, because `assertNoteHtmlAllowed` throws while the module-level fixture is rendered. These are caught by the renderer's own whitelist check, not by a single named assertion.
  - B1, the "and" hardcoded instead of the locale's term: it survived the first sweep. I added a test with "와/과" for two authors, and it is now killed (1 failed).

FINDINGS
1. **P1-T44 badge: not reproduced.** In all three new runs the badge read "Protected by Windows Credential Manager" and the test passed. Run 3 of the earlier set (text="") is the only failure seen in seven full runs.
2. **The CSL `ko-KR` "et al." term is "기타",** not "등" (the note editor's Korean) and not `formatCitation`'s "등". This only matters if a report ever passes `ko-KR`; 294(a) says every report passes `en-US`.
3. **A tag-name mismatch outside this card:** docs/07 §6.4 names the summary-note tag `research_helper/summary`, while the P3-T29 card (step 5) says `research_helper/ai-summary`. My P3-T29 note says "its tag (step 5)" so it does not pick one. Worth a backlog line.
4. **Nobody writes the overflow note today:** `buildItem` in `importer.ts` deliberately skips it. The new `itemMapper.ts` comment says that whatever code writes it must store its key and tag it.
5. **Tooling quirk:** the file-writing tool turned `\uE000`-style escapes into literal invisible characters. The source now builds those characters from code points (`String.fromCharCode`), and the changed files were scanned for invisible characters: none remain.

WHAT I DID NOT CHECK
- A group library: the `selectUri` group form and the nodes there.
- The item-pane and tab note editors.
- How a Markdown viewer actually renders the escaped export; the CommonMark behaviour was reasoned about, not rendered.
- Real P4-T12 or P4-T18 output and real model prose; every fixture is synthetic.
- Nested emphasis edge cases (for example `**a *b** c*` can produce badly nested but still allowed tags) and ordered lists that do not start at 1. Nested lists were checked only for simple indentation.
- The Korean editor display of the renderer's own output; the renderer test is pinned to `en-US`.

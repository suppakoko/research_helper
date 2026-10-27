/**
 * `P3-T23`: the chunker's single-shot, section-aware and flat paths, the
 * §5.2 budget with D-06-5's multiplier and reserve, and §13.5's one halved
 * retry (`docs/06` §5.1–§5.3, §13.5).
 *
 * Every paper below is SYNTHETIC text written here, except two reads of the
 * committed `P3-T20` texts (`test/fixtures/imrad/text/`) for their line shape
 * alone — no label is read or inferred. No network, no key, no LLM call.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryPrefStore } from "../../../src/core/config";
import {
  ConfigurationError,
  ContextLengthExceededError,
} from "../../../src/core/errors";
import {
  CHUNK_OVERLAP_TOKENS,
  CONTEXT_RETRY_BUDGET_SCALE,
  ESTIMATE_HEADROOM,
  MAP_CALL_BUDGETS,
  MAX_CHUNKS,
  PARAGRAPH_LINE_SHARE_CUTOFF,
  RESERVE_TOKENS,
  SECTION_SHARES,
  SYNTHESIS_RANK,
  UNKNOWN_SECTION,
  chunkLabel,
  measureLineShape,
  planChunks,
  runWithContextRetry,
  windowRoom,
  type ChunkModel,
  type ChunkPlan,
  type ChunkableSource,
  type ChunkedPlan,
  type PlanChunksOptions,
  type TextChunk,
} from "../../../src/llm/shared/chunking";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type { ImradSection } from "../../../src/model/summary";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import {
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
  createPromptRegistry,
  resolveMaxTokens,
} from "../../../src/prompts";
import {
  SIXTY_K,
  flowing,
  hardWrapped,
  paper,
  sentence,
} from "../../support/syntheticPaper";

afterEach(() => {
  setPrefStore(undefined);
});

// ===========================================================================
// Helpers
// ===========================================================================

const PROMPTS = createPromptRegistry(
  PROMPT_IDS.map((id) => ({
    fileName: PROMPT_FILE_NAMES[id],
    text: readFileSync(
      resolve(process.cwd(), "src/prompts", PROMPT_FILE_NAMES[id]),
      "utf8",
    ),
  })),
);

/** Round figures standing for the caller's measured prompt overheads. */
const OVERHEAD = { PAPER_SUMMARY_FULLTEXT: 1_500, CHUNK_MAP: 500 } as const;

/** A window large enough that only §5.2's column binds. */
const BIG: ChunkModel = { id: "test/big", contextWindowTokens: 1_000_000 };

/** The raw heuristic: no model id, so no preference is read. */
const count = (text: string): number => estTokens(text);

function options(extra: Partial<PlanChunksOptions> = {}): PlanChunksOptions {
  return { prompts: PROMPTS, overhead: OVERHEAD, countTokens: count, ...extra };
}

function chunked(plan: ChunkPlan): ChunkedPlan {
  expect(plan.kind).toBe("chunked");
  return plan as ChunkedPlan;
}

/** Each chunk's new content, overlap removed. */
function content(chunk: TextChunk): string {
  return chunk.text.slice(chunk.contentStart - chunk.start);
}

// ===========================================================================
// The numbers
// ===========================================================================

describe("the numbers (docs/06 §5.1–§5.3)", () => {
  it("carries D-06-5's figures and §13.5's halving", () => {
    expect(ESTIMATE_HEADROOM).toBe(1.15);
    expect(CHUNK_OVERLAP_TOKENS).toBe(250);
    expect(RESERVE_TOKENS).toBe(800);
    expect(CONTEXT_RETRY_BUDGET_SCALE).toBe(0.5);
  });

  it("plans the same without a prompt registry, from §5.2's ceilings", () => {
    const source = paper(null, [
      { heading: "Results", labels: ["results"], tokens: 30_000 },
    ]);
    const { prompts: _registry, ...bare } = options();
    expect(planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", bare)).toEqual(
      planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    expect(MAP_CALL_BUDGETS.CHUNK_MAP.maxOutputTokens).toBe(
      resolveMaxTokens(PROMPTS.get("CHUNK_MAP")),
    );
    expect(MAP_CALL_BUDGETS.PAPER_SUMMARY_FULLTEXT.maxOutputTokens).toBe(
      resolveMaxTokens(PROMPTS.get("PAPER_SUMMARY_FULLTEXT")),
    );
  });

  it("derives the chunk ceiling from CHUNK_REDUCE's budget and CHUNK_MAP's max_tokens", () => {
    expect(MAX_CHUNKS).toBe(
      Math.floor(
        MAP_CALL_BUDGETS.CHUNK_REDUCE.inputTokens /
          resolveMaxTokens(PROMPTS.get("CHUNK_MAP")),
      ),
    );
    expect(MAX_CHUNKS).toBe(13);
  });

  it("transcribes §5.3 steps 1 and 2 from the document", () => {
    const doc = readFileSync(
      resolve(process.cwd(), "docs/06-summarization-and-trend-report.md"),
      "utf8",
    );
    const step2 = /^2\. Assign each section a share[^\n]*$/m.exec(doc)?.[0];
    expect(step2).toBeDefined();
    const shares = [...(step2 as string).matchAll(/`(\w+)` (\d+) %/g)];
    expect(shares).toHaveLength(7);
    for (const [, label, pct] of shares) {
      expect(SECTION_SHARES[label as ImradSection], label).toBeCloseTo(
        Number(pct) / 100,
        10,
      );
    }
    const named = new Set(shares.map((m) => m[1]));
    for (const [label, share] of Object.entries(SECTION_SHARES)) {
      if (!named.has(label)) expect(share, label).toBe(0);
    }

    const step1 = /^1\. Order sections by \*\*synthesis value\*\*[^\n]*$/m.exec(
      doc,
    )?.[0];
    const order = [...(step1 as string).matchAll(/`(\w+)`/g)].map((m) => m[1]);
    expect(order).toEqual([
      "abstract",
      "results",
      "methods",
      "discussion",
      "conclusion",
      "limitations",
      "introduction",
      "background",
      "related_work",
      "other",
    ]);
    const ranks = order.map((label) => SYNTHESIS_RANK[label as ImradSection]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(SYNTHESIS_RANK.background).toBe(SYNTHESIS_RANK.related_work);
  });

  it("labels a chunk as §5.3 step 5 shows", () => {
    expect(chunkLabel("results", 3, 7, "ABCD1234")).toBe(
      "[SECTION: results] [CHUNK 3/7] [PAPER: itemKey ABCD1234]",
    );
  });
});

// ===========================================================================
// Single-shot and the §5.2 inequality
// ===========================================================================

describe("single-shot (docs/06 §5.3) and the budget (§5.2, D-06-5)", () => {
  it("plans a 9 000-token text against a 24 000-token budget as one call", () => {
    const source = paper(null, [
      { heading: "Methods", labels: ["methods"], tokens: 4_500 },
      { heading: "Results", labels: ["results"], tokens: 4_500 },
    ]);
    const tokens = count(source.text);
    expect(tokens).toBeGreaterThanOrEqual(9_000);
    expect(tokens).toBeLessThan(9_500);
    const plan = planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options());
    expect(plan).toEqual({
      kind: "single-shot",
      promptId: "PAPER_SUMMARY_FULLTEXT",
      textTokens: tokens,
      budgetTokens: 24_000,
      budgetScale: 1,
    });
  });

  it("chunks a text one token over the budget, and never one at it", () => {
    const text = "a".repeat(Math.round(24_000 * 3.7));
    expect(count(text)).toBe(24_000);
    const at: ChunkableSource = {
      itemKey: "K",
      abstract: null,
      sections: [],
      sectionAware: false,
      text,
    };
    expect(planChunks(at, BIG, "PAPER_SUMMARY_FULLTEXT", options()).kind).toBe(
      "single-shot",
    );
    const over = { ...at, text: `${text}aaaa` };
    expect(
      planChunks(over, BIG, "PAPER_SUMMARY_FULLTEXT", options()).kind,
    ).toBe("chunked");
  });

  it("applies the 1.15× multiplier and the 800-token reserve to the window", () => {
    const source = paper(null, [
      { heading: "Results", labels: ["results"], tokens: 9_000 },
    ]);
    const text = count(source.text);
    // Without the multiplier, or without the reserve, this window holds the
    // text single-shot; with both it does not.
    const window = 14_000;
    const out = resolveMaxTokens(PROMPTS.get("PAPER_SUMMARY_FULLTEXT"));
    expect(OVERHEAD.PAPER_SUMMARY_FULLTEXT + text).toBeLessThanOrEqual(
      window - out - RESERVE_TOKENS,
    );
    expect(
      Math.ceil(1.15 * (OVERHEAD.PAPER_SUMMARY_FULLTEXT + text)),
    ).toBeLessThanOrEqual(window - out);
    const model = { id: "test/14k", contextWindowTokens: window };
    const plan = chunked(
      planChunks(source, model, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    // Every chunk call satisfies the inequality with both.
    const mapOut = resolveMaxTokens(PROMPTS.get("CHUNK_MAP"));
    for (const chunk of plan.chunks) {
      const sent = OVERHEAD.CHUNK_MAP + count(chunk.label) + chunk.tokens;
      expect(Math.ceil(1.15 * sent)).toBeLessThanOrEqual(
        window - mapOut - RESERVE_TOKENS,
      );
      expect(count(chunk.text)).toBeLessThanOrEqual(chunk.tokens);
    }
    expect(windowRoom(window, mapOut)).toBe(
      Math.floor((window - mapOut - RESERVE_TOKENS) / 1.15),
    );
  });

  it("uses §5.2's column alone when the window is not known", () => {
    const source = paper(null, [
      { heading: "Results", labels: ["results"], tokens: 20_000 },
    ]);
    for (const contextWindowTokens of [0, undefined]) {
      const plan = planChunks(
        source,
        { id: "test/unknown", contextWindowTokens },
        "PAPER_SUMMARY_FULLTEXT",
        options(),
      );
      expect(plan.kind).toBe("single-shot");
    }
  });

  it("refuses a window too small to hold a chunk beside CHUNK_MAP's prompt", () => {
    const source = paper(null, [
      { heading: "Results", labels: ["results"], tokens: 9_000 },
    ]);
    expect(() =>
      planChunks(
        source,
        { id: "test/4k", contextWindowTokens: 2_500 },
        "PAPER_SUMMARY_FULLTEXT",
        options(),
      ),
    ).toThrow(ConfigurationError);
  });

  it("counts with the model's stored calibration by default (P3-T13)", () => {
    setPrefStore(
      createMemoryPrefStore({
        [PREF_KEYS.llmTokenEstimateCalibration]: '{"test/big": 3}',
      }),
    );
    const source = paper(null, [
      { heading: "Results", labels: ["results"], tokens: 9_000 },
    ]);
    const { countTokens: _raw, ...calibrated } = options();
    const plan = planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", calibrated);
    // 9 000 raw × 3 is over the 24 000 budget: the calibrated count decided.
    expect(plan.kind).toBe("chunked");
    expect(plan.textTokens).toBe(Math.ceil(count(source.text) * 3 - 1e-9));
  });

  it("plans an empty text as a single shot of nothing", () => {
    const empty: ChunkableSource = {
      itemKey: "K",
      abstract: null,
      sections: [],
      sectionAware: false,
      text: "",
    };
    expect(
      planChunks(empty, BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    ).toMatchObject({ kind: "single-shot", textTokens: 0 });
  });
});

// ===========================================================================
// The section-aware path
// ===========================================================================

function sixtyK(): ChunkableSource {
  return paper(sentence(9_999).repeat(20), SIXTY_K);
}

/**
 * The same sections at two fifths of the length (just over the single-shot
 * budget): within 13 full-size chunks
 * at full scale, so nothing is cut. (At 60 000 tokens the section-aware path
 * needs more than 13 chunks of 6 000, because each section starts its own.)
 */
function shortPaper(): ChunkableSource {
  return paper(
    sentence(9_999).repeat(20),
    SIXTY_K.map((spec) => ({
      ...spec,
      tokens: Math.round((spec.tokens * 2) / 5),
    })),
  );
}

function sectionTokens(plan: ChunkedPlan): Map<string, number> {
  const tokens = new Map<string, number>();
  for (const chunk of plan.chunks) {
    tokens.set(
      chunk.section,
      (tokens.get(chunk.section) ?? 0) + count(content(chunk)),
    );
  }
  return tokens;
}

describe("the section-aware path (docs/06 §5.3)", () => {
  it("gives each section its §5.3 share of a 60 000-token paper, within 5 %", () => {
    const source = sixtyK();
    const total = count(source.text);
    expect(total).toBeGreaterThanOrEqual(60_000);
    expect(total).toBeLessThan(61_000);
    // The halved budget of a context-length retry: 13 chunks of 3 000 tokens
    // cannot hold 60 000, so the shares decide what is sent.
    const plan = chunked(
      planChunks(
        source,
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options({ budgetScale: 0.5 }),
      ),
    );
    expect(plan.path).toBe("section-aware");
    expect(plan.truncated).toBe(true);
    expect(plan.chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    const tokens = sectionTokens(plan);
    const sent = [...tokens.values()].reduce((a, b) => a + b, 0);
    for (const [label, share] of Object.entries(SECTION_SHARES)) {
      const got = (tokens.get(label) ?? 0) / sent;
      expect(
        Math.abs(got - share),
        `${label}: ${got.toFixed(3)}`,
      ).toBeLessThanOrEqual(0.05);
    }
    // The 0 % sections are the ones dropped.
    expect(tokens.has("background")).toBe(false);
    expect(tokens.has("other")).toBe(false);
    expect(plan.cutSections).toEqual(
      expect.arrayContaining([
        "background",
        "other",
        "results",
        "introduction",
      ]),
    );
  });

  it("orders chunks by synthesis value, never by document order", () => {
    const plan = chunked(
      planChunks(shortPaper(), BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    const ranks = plan.chunks.map(
      (c) => SYNTHESIS_RANK[c.labels[0] as ImradSection],
    );
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(plan.chunks[0]?.section).toBe("abstract");
    expect(plan.chunks.at(-1)?.section).toBe("other");
    // Document order would have put the title block first.
    expect(plan.chunks.map((c) => c.start)).not.toEqual(
      [...plan.chunks.map((c) => c.start)].sort((a, b) => a - b),
    );
  });

  it("reassembles every section from its chunks minus their overlap", () => {
    const source = shortPaper();
    const plan = chunked(
      planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    expect(plan.truncated).toBe(false);
    const spans = [
      { start: 0, end: (source.abstract as string).length },
      ...source.sections,
    ];
    for (const span of spans) {
      const own = plan.chunks.filter(
        (c) => c.start >= span.start && c.end <= span.end,
      );
      expect(own.length).toBeGreaterThan(0);
      expect(own.map(content).join("")).toBe(
        source.text.slice(span.start, span.end),
      );
    }
  });

  it("never carries overlap across a section boundary", () => {
    const source = sixtyK();
    for (const budgetScale of [1, 0.5]) {
      const plan = chunked(
        planChunks(
          source,
          BIG,
          "PAPER_SUMMARY_FULLTEXT",
          options({ budgetScale }),
        ),
      );
      const spans = [
        { start: 0, end: (source.abstract as string).length },
        ...source.sections,
      ];
      let overlapped = 0;
      for (const chunk of plan.chunks) {
        const home = spans.filter(
          (s) => chunk.start >= s.start && chunk.end <= s.end,
        );
        expect(home, chunk.label).toHaveLength(1);
        expect(chunk.overlapTokens).toBeLessThanOrEqual(CHUNK_OVERLAP_TOKENS);
        expect(chunk.tokens).toBeLessThanOrEqual(plan.chunkBudgetTokens);
        if (chunk.overlapTokens > 0) overlapped += 1;
        // The overlap is the end of the chunk before it, in the same section.
        if (chunk.contentStart > chunk.start) {
          const before = plan.chunks[chunk.index - 2] as TextChunk;
          expect(before.section).toBe(chunk.section);
          expect(before.end).toBe(chunk.contentStart);
          expect(
            before.text.endsWith(
              chunk.text.slice(0, chunk.contentStart - chunk.start),
            ),
          ).toBe(true);
        }
      }
      expect(overlapped).toBeGreaterThan(0);
    }
  });

  it("labels every chunk with its section, its position and the item key", () => {
    const plan = chunked(
      planChunks(sixtyK(), BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    plan.chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i + 1);
      expect(chunk.total).toBe(plan.chunks.length);
      expect(chunk.label).toBe(
        `[SECTION: ${chunk.section}] [CHUNK ${i + 1}/${plan.chunks.length}] [PAPER: itemKey ABCD1234]`,
      );
    });
  });

  it("gives a combined Results and Discussion section both shares, under results", () => {
    const source = paper(null, [
      { heading: "Introduction", labels: ["introduction"], tokens: 20_000 },
      { heading: "Methods", labels: ["methods"], tokens: 20_000 },
      {
        heading: "Results and Discussion",
        labels: ["results", "discussion"],
        tokens: 30_000,
      },
    ]);
    const plan = chunked(
      planChunks(
        source,
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options({ budgetScale: 0.5 }),
      ),
    );
    expect(plan.chunks[0]?.section).toBe("results+discussion");
    expect(plan.chunks[0]?.labels).toEqual(["results", "discussion"]);
    const tokens = sectionTokens(plan);
    const sent = [...tokens.values()].reduce((a, b) => a + b, 0);
    // 50 % of the budget, then what the absent labels leave, in synthesis order.
    expect((tokens.get("results+discussion") ?? 0) / sent).toBeGreaterThan(
      0.45,
    );
  });
});

// ===========================================================================
// The flat path
// ===========================================================================

describe("the flat path (docs/06 §5.3)", () => {
  it("labels every chunk unknown when sectionAware is false, sections or not", () => {
    const source = paper(sentence(1), SIXTY_K, false);
    const plan = chunked(
      planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    expect(plan.path).toBe("flat");
    for (const chunk of plan.chunks) {
      expect(chunk.section).toBe(UNKNOWN_SECTION);
      expect(chunk.labels).toEqual([]);
      expect(chunk.label.startsWith("[SECTION: unknown] ")).toBe(true);
    }
  });

  it("caps a long last paragraph's overlap at 250 tokens of whole sentences", () => {
    // Paragraphs of 24 sentences, about 520 tokens each.
    const text = flowing(30_000, 0, 24);
    const plan = chunked(
      planChunks(
        {
          itemKey: "K",
          abstract: null,
          sections: [],
          sectionAware: false,
          text,
        },
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options(),
      ),
    );
    expect(plan.lineShape.unit).toBe("paragraph");
    for (const chunk of plan.chunks.slice(1)) {
      const overlap = text.slice(chunk.start, chunk.contentStart);
      expect(chunk.overlapTokens).toBeGreaterThan(0);
      expect(chunk.overlapTokens).toBeLessThanOrEqual(CHUNK_OVERLAP_TOKENS);
      expect(count(overlap)).toBeLessThanOrEqual(CHUNK_OVERLAP_TOKENS);
      expect(overlap).toMatch(/^\p{Lu}/u);
      expect(SENTENCE_TAIL.test(overlap)).toBe(true);
    }
    expect(plan.chunks.map(content).join("")).toBe(text);
  });

  it("packs in document order and reassembles the whole text", () => {
    const source = paper(sentence(1), SIXTY_K, false);
    const plan = chunked(
      planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    expect(plan.truncated).toBe(false);
    expect(plan.chunks.map(content).join("")).toBe(source.text);
    // Overlap between every adjacent pair whose boundary allows it.
    for (const chunk of plan.chunks.slice(1)) {
      expect(chunk.overlapTokens).toBeGreaterThan(0);
      expect(chunk.overlapTokens).toBeLessThanOrEqual(CHUNK_OVERLAP_TOKENS);
    }
  });

  it("keeps the first 13 chunks of a text too long for them, and says so", () => {
    const source: ChunkableSource = {
      itemKey: "K",
      abstract: null,
      sections: [],
      sectionAware: false,
      text: flowing(100_000),
    };
    const plan = chunked(
      planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    expect(plan.chunks).toHaveLength(MAX_CHUNKS);
    expect(plan.truncated).toBe(true);
    expect(plan.chunks[0]?.start).toBe(0);
    expect(plan.chunks.at(-1)?.total).toBe(MAX_CHUNKS);
  });

  it("cuts one 50 000-character word into pieces that fit, losing nothing", () => {
    const source: ChunkableSource = {
      itemKey: "K",
      abstract: null,
      sections: [],
      sectionAware: false,
      text: "x".repeat(50_000),
    };
    const plan = chunked(
      planChunks(
        source,
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options({ budgetScale: 0.5 }),
      ),
    );
    expect(plan.chunks.map(content).join("")).toBe(source.text);
    for (const chunk of plan.chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(plan.chunkBudgetTokens);
    }
  });
});

// ===========================================================================
// Units: the measured line shape (§5.3 step 3; owner, plan/00 §6 item 299(a))
// ===========================================================================

/** A unit ends after a sentence terminal and its whitespace. */
const SENTENCE_TAIL = /[.!?。！？]["'”’)\]]*\s*$/u;

describe("paragraph and sentence units (docs/06 §5.3 step 3, corrected D-06-4)", () => {
  it("reads flowing text as paragraphs and keeps each paragraph in one chunk", () => {
    const text = flowing(30_000);
    expect(measureLineShape(text).unit).toBe("paragraph");
    const plan = chunked(
      planChunks(
        {
          itemKey: "K",
          abstract: null,
          sections: [],
          sectionAware: false,
          text,
        },
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options(),
      ),
    );
    for (const chunk of plan.chunks) {
      expect(chunk.text.endsWith("\n")).toBe(true);
      expect(text[chunk.contentStart - 1] ?? "\n").toBe("\n");
    }
  });

  it("does not split a hard-wrapped text (one \\n per printed line) mid-sentence", () => {
    const text = hardWrapped(30_000);
    const shape = measureLineShape(text);
    expect(shape.unit).toBe("sentence");
    expect(shape.longSegmentShare).toBe(0);
    const plan = chunked(
      planChunks(
        {
          itemKey: "K",
          abstract: null,
          sections: [],
          sectionAware: false,
          text,
        },
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options(),
      ),
    );
    const lines = text.split("\n").length;
    expect(plan.chunks.length).toBeLessThan(lines / 10);
    for (const chunk of plan.chunks) {
      expect(SENTENCE_TAIL.test(chunk.text), chunk.label).toBe(true);
      // The overlap starts a sentence, too.
      expect(text.slice(chunk.start, chunk.start + 1)).toMatch(/\p{Lu}/u);
    }
    expect(plan.chunks.map(content).join("")).toBe(text);
  });

  it("keeps Fig. 3, e.g. and initials inside one sentence", () => {
    const text = [
      "As Fig. 3 shows, the dose mattered. ",
      "Some agents, e.g. Aspirin, were excluded. ",
      "J. Smith ran the assay. ",
      "It worked.",
    ]
      .join("")
      .repeat(400)
      .replace(/(.{70}) /g, "$1\n");
    expect(measureLineShape(text).unit).toBe("sentence");
    const plan = chunked(
      planChunks(
        {
          itemKey: "K",
          abstract: null,
          sections: [],
          sectionAware: false,
          text,
        },
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options({ budgetScale: 0.1 }),
      ),
    );
    for (const chunk of plan.chunks) {
      expect(chunk.text).not.toMatch(/(Fig\.|e\.g\.|J\.)\s*$/);
      expect(SENTENCE_TAIL.test(chunk.text)).toBe(true);
    }
  });

  it("cuts at the owner's 0.5 (plan/00 §6 item 299(a))", () => {
    expect(PARAGRAPH_LINE_SHARE_CUTOFF).toBe(0.5);
  });

  // The nearest texts on each side of the gap (S4 0.191, B4 0.664) and two
  // from each end of it.
  it.each([
    ["XR2", "sentence"],
    ["A1", "sentence"],
    ["S4", "sentence"],
    ["B4", "paragraph"],
    ["S5", "paragraph"],
    ["E1", "paragraph"],
  ] as const)("reads the committed P3-T20 text %s as %s units", (id, unit) => {
    const text = readFileSync(
      resolve(process.cwd(), "test/fixtures/imrad/text", `${id}.txt`),
      "utf8",
    );
    const shape = measureLineShape(text);
    expect(shape.unit).toBe(unit);
    expect(
      Math.abs(shape.longSegmentShare - PARAGRAPH_LINE_SHARE_CUTOFF),
    ).toBeGreaterThan(0.15);
    if (unit === "sentence") {
      const plan = chunked(
        planChunks(
          {
            itemKey: id,
            abstract: null,
            sections: [],
            sectionAware: false,
            text,
          },
          BIG,
          "PAPER_SUMMARY_FULLTEXT",
          options({ budgetScale: 0.2 }),
        ),
      );
      expect(plan.chunks.map(content).join("")).toBe(
        text.slice(0, plan.chunks.at(-1)?.end),
      );
      for (const chunk of plan.chunks.slice(0, -1)) {
        expect(SENTENCE_TAIL.test(chunk.text), chunk.label).toBe(true);
      }
    }
  });
});

// ===========================================================================
// §13.5: halve and retry once
// ===========================================================================

describe("the context-length retry (docs/06 §13.5)", () => {
  const source = paper(null, [
    { heading: "Results", labels: ["results"], tokens: 20_000 },
  ]);
  const planAt = (budgetScale: number): ChunkPlan =>
    planChunks(source, BIG, "PAPER_SUMMARY_FULLTEXT", options({ budgetScale }));
  const tooLong = (): ContextLengthExceededError =>
    new ContextLengthExceededError("openrouter", "test/big", "context length");

  it("retries exactly once with the halved budget, then propagates", async () => {
    const seen: ChunkPlan[] = [];
    await expect(
      runWithContextRetry(planAt, (plan) => {
        seen.push(plan);
        return Promise.reject(tooLong());
      }),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ kind: "single-shot", budgetScale: 1 });
    // 20 000 tokens no longer fit 12 000: the retry is chunked, not unchanged.
    expect(seen[1]).toMatchObject({ kind: "chunked", budgetScale: 0.5 });
  });

  it("returns the retry's result when the halved plan succeeds", async () => {
    let calls = 0;
    const result = await runWithContextRetry(planAt, (plan) => {
      calls += 1;
      return plan.budgetScale === 1
        ? Promise.reject(tooLong())
        : Promise.resolve(plan.kind);
    });
    expect(calls).toBe(2);
    expect(result).toBe("chunked");
  });

  it("does not retry any other error", async () => {
    let calls = 0;
    await expect(
      runWithContextRetry(planAt, () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });

  it("propagates at once when halving would not change the plan", async () => {
    const tiny = paper(null, [
      { heading: "Results", labels: ["results"], tokens: 100 },
    ]);
    let calls = 0;
    await expect(
      runWithContextRetry(
        (budgetScale) =>
          planChunks(
            tiny,
            BIG,
            "PAPER_SUMMARY_FULLTEXT",
            options({ budgetScale }),
          ),
        () => {
          calls += 1;
          return Promise.reject(tooLong());
        },
      ),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);
    expect(calls).toBe(1);
  });

  it("halves both per-call budgets", () => {
    const full = chunked(
      planChunks(sixtyK(), BIG, "PAPER_SUMMARY_FULLTEXT", options()),
    );
    const half = chunked(
      planChunks(
        sixtyK(),
        BIG,
        "PAPER_SUMMARY_FULLTEXT",
        options({ budgetScale: 0.5 }),
      ),
    );
    expect(half.chunkBudgetTokens).toBe(Math.floor(full.chunkBudgetTokens / 2));
    const single = planAt(0.5);
    expect(single.kind).toBe("chunked");
    expect(() => planAt(0)).toThrow(RangeError);
  });
});

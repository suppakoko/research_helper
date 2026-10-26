/**
 * `P4-T10` — the citation validator and marker binding of the trend report
 * (`docs/06` §10.1–§10.2, §13.4; `docs/12` §10 checks 2 and 5).
 *
 * Every report text here is synthetic and written in this file. No network,
 * no model: the validator calls neither.
 */

import { describe, expect, it } from "vitest";

import { createManualClock } from "../../../src/core/clock";
import { createLogger, type LogSink } from "../../../src/core/logger";
import {
  assertAllMarkersResolve,
  bindMarkers,
  citedKeysOf,
  INVALID_CITATION_TEXT,
  ITEM_KEY_RE,
  validateCitations,
  type CitationContext,
} from "../../../src/pipeline/trendReport/citations";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const A = "AAAA1111";
const B = "BBBB2222";
const C = "CCCC3333";
const D = "DDDD4444";
/** In the collection, but retracted: never in the valid set. */
const RETRACTED = "RETR0001";
/** Not in the collection at all. */
const STRANGER = "ZZZZ9999";
/** Dropped as a duplicate of `A`. */
const DUP_OF_A = "DUPE0001";
/** Dropped as a duplicate of the retracted item. */
const DUP_OF_RETRACTED = "DUPE0002";

const VALID = new Set([A, B, C, D]);
const DUPLICATES = new Map([
  [DUP_OF_A, A],
  [DUP_OF_RETRACTED, RETRACTED],
]);

/** A sentence that must never reach the log. */
const PROSE = "Polygenic scores improved discrimination in the cohort";

interface Captured {
  readonly context: CitationContext;
  readonly lines: string[];
}

function context(overrides: Partial<CitationContext> = {}): Captured {
  const lines: string[] = [];
  const sink: LogSink = { write: (line) => lines.push(line) };
  const logger = createLogger({ sink, clock: createManualClock() });
  return {
    lines,
    context: {
      validKeys: VALID,
      duplicateOf: DUPLICATES,
      logger,
      ...overrides,
    },
  };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

describe("validateCitations — valid markers", () => {
  it("leaves a fully valid text byte for byte and logs nothing", () => {
    const { context: ctx, lines } = context();
    const text = `## 1. Executive Summary\n- ${PROSE} [[${B}]][[${A}]].\n- Again [[${B}]].\n`;
    const result = validateCitations(text, ctx);
    expect(result.markdown).toBe(text);
    expect(result.citedKeys).toEqual([B, A]);
    expect(result.removed).toEqual([]);
    expect(result.figures).toEqual({
      markerCount: 3,
      splitMarkerCount: 0,
      resolvedCount: 3,
      rewrittenCount: 0,
      malformedCount: 0,
      notInValidSetCount: 0,
      brokenCitationCount: 0,
      fencedMarkerCount: 0,
      distinctCitedCount: 2,
      coverageRatio: 2 / 4,
      resolvedShare: 1,
    });
    expect(lines).toEqual([]);
  });

  it("reports no resolution share, and zero coverage, for a text with no marker", () => {
    const { context: ctx } = context();
    const result = validateCitations(`${PROSE}.`, ctx);
    expect(result.figures.resolvedShare).toBeUndefined();
    expect(result.figures.coverageRatio).toBe(0);
    expect(result.citedKeys).toEqual([]);
  });

  it("gives coverage 0, not NaN, when the valid set is empty", () => {
    const { context: ctx } = context({ validKeys: new Set() });
    const result = validateCitations(`x [[${A}]]`, ctx);
    expect(result.figures.coverageRatio).toBe(0);
    expect(result.figures.brokenCitationCount).toBe(1);
  });
});

describe("validateCitations — invalid markers are replaced visibly", () => {
  it("replaces a marker to a non-member with docs/06 §10.1's text, counts it, and logs its key only", () => {
    const { context: ctx, lines } = context();
    const text = `${PROSE} [[${STRANGER}]] and [[${A}]].`;
    const result = validateCitations(text, ctx);
    expect(INVALID_CITATION_TEXT).toBe("[citation removed: invalid reference]");
    expect(result.markdown).toBe(
      `${PROSE} [citation removed: invalid reference] and [[${A}]].`,
    );
    expect(result.removed).toEqual([
      { reason: "not_in_valid_set", raw: `[[${STRANGER}]]`, key: STRANGER },
    ]);
    expect(result.figures).toMatchObject({
      markerCount: 2,
      resolvedCount: 1,
      notInValidSetCount: 1,
      malformedCount: 0,
      brokenCitationCount: 1,
      resolvedShare: 1,
    });
    expect(lines).toHaveLength(1);
    const logged = JSON.parse(
      lines[0]?.replace(/^\[research_helper\] /, "") ?? "",
    ) as Record<string, unknown>;
    expect(logged).toMatchObject({
      lvl: "warn",
      msg: "citation marker removed",
      reason: "not_in_valid_set",
      key: STRANGER,
    });
    expect(lines[0]).not.toContain("Polygenic");
  });

  it("replaces a marker to a retracted item: it is not in the valid set", () => {
    const { context: ctx } = context();
    const result = validateCitations(`x [[${RETRACTED}]]`, ctx);
    expect(result.markdown).toBe(`x ${INVALID_CITATION_TEXT}`);
    expect(result.removed[0]?.reason).toBe("not_in_valid_set");
  });

  it("replaces every malformed marker without trimming or re-casing it, and logs only its length", () => {
    const { context: ctx, lines } = context();
    // A combined marker (`[[A, B]]`) is split instead (item 292(c)); see
    // "combined markers" below.
    const malformed = [
      "[[aaaa1111]]",
      "[[AAAA111]]",
      `[[${A} ${B}]]`,
      "[[]]",
      `[[ ${A} ]]`,
      "[[Kim 2025]]",
    ];
    const text = malformed.map((m) => `${PROSE} ${m}.`).join("\n");
    const result = validateCitations(text, ctx);
    expect(result.markdown).toBe(
      malformed.map(() => `${PROSE} ${INVALID_CITATION_TEXT}.`).join("\n"),
    );
    expect(result.figures).toMatchObject({
      markerCount: 6,
      resolvedCount: 0,
      malformedCount: 6,
      notInValidSetCount: 0,
      brokenCitationCount: 6,
      resolvedShare: undefined,
    });
    expect(result.removed.map((r) => r.raw)).toEqual(malformed);
    expect(result.removed.every((r) => r.key === undefined)).toBe(true);
    expect(result.citedKeys).toEqual([]);
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line).toContain('"reason":"malformed"');
      expect(line).toContain('"markerLength":');
      expect(line).not.toContain("Kim");
      expect(line).not.toContain("aaaa");
      expect(line).not.toContain(A);
    }
  });

  it("never deletes silently: one replacement text per removed marker, every marker accounted for", () => {
    const { context: ctx } = context();
    const text = [
      `- [[${A}]] [[${STRANGER}]] [[bad]] [[${DUP_OF_A}]]`,
      `- [[${DUP_OF_RETRACTED}]] [[${C}]] [[${RETRACTED}]]`,
    ].join("\n");
    const result = validateCitations(text, ctx);
    const f = result.figures;
    expect(count(result.markdown, INVALID_CITATION_TEXT)).toBe(
      f.brokenCitationCount,
    );
    expect(f.brokenCitationCount).toBe(4);
    expect(f.markerCount).toBe(f.resolvedCount + f.brokenCitationCount);
    expect(f.markerCount).toBe(7);
    expect(() => assertAllMarkersResolve(result.markdown, VALID)).not.toThrow();
  });

  it("uses a caller's replacement text when given one", () => {
    const { context: ctx } = context({ replacement: "[REMOVED]" });
    expect(validateCitations(`x [[${STRANGER}]]`, ctx).markdown).toBe(
      "x [REMOVED]",
    );
  });
});

describe("validateCitations — duplicates (docs/06 §13.4)", () => {
  it("rewrites a dropped duplicate's key to the kept key and counts it as resolved", () => {
    const { context: ctx, lines } = context();
    const text = `First [[${B}]], then [[${DUP_OF_A}]], then [[${A}]].`;
    const result = validateCitations(text, ctx);
    expect(result.markdown).toBe(
      `First [[${B}]], then [[${A}]], then [[${A}]].`,
    );
    expect(result.citedKeys).toEqual([B, A]);
    expect(result.figures).toMatchObject({
      markerCount: 3,
      resolvedCount: 3,
      rewrittenCount: 1,
      brokenCitationCount: 0,
      distinctCitedCount: 2,
    });
    expect(lines).toEqual([]);
  });

  it("replaces a duplicate whose kept key is outside the valid set, naming the kept key", () => {
    const { context: ctx } = context();
    const result = validateCitations(`x [[${DUP_OF_RETRACTED}]]`, ctx);
    expect(result.markdown).toBe(`x ${INVALID_CITATION_TEXT}`);
    expect(result.removed).toEqual([
      {
        reason: "not_in_valid_set",
        raw: `[[${DUP_OF_RETRACTED}]]`,
        key: RETRACTED,
      },
    ]);
    expect(result.figures.rewrittenCount).toBe(0);
  });
});

describe("validateCitations — combined markers (owner, 2026-10-27, plan/00 §6 item 292(c))", () => {
  it("splits a comma-combined marker into one marker per part, joined by one space", () => {
    const { context: ctx, lines } = context();
    const result = validateCitations(`${PROSE} [[${A}, ${B}]].`, ctx);
    expect(result.markdown).toBe(`${PROSE} [[${A}]] [[${B}]].`);
    expect(result.citedKeys).toEqual([A, B]);
    expect(result.removed).toEqual([]);
    expect(result.figures).toMatchObject({
      markerCount: 2,
      splitMarkerCount: 1,
      resolvedCount: 2,
      brokenCitationCount: 0,
      resolvedShare: 1,
    });
    expect(lines).toEqual([]);
  });

  it("splits at a semicolon too, with or without whitespace around either separator", () => {
    for (const written of [
      `[[${A}; ${B}]]`,
      `[[${A};${B}]]`,
      `[[${A} ,${B}]]`,
      `[[${A} ;  ${B}]]`,
    ]) {
      const result = validateCitations(`x ${written} y`, context().context);
      expect(result.markdown, written).toBe(`x [[${A}]] [[${B}]] y`);
      expect(result.figures.splitMarkerCount, written).toBe(1);
    }
    const three = validateCitations(`[[${C}, ${A}; ${B}]]`, context().context);
    expect(three.markdown).toBe(`[[${C}]] [[${A}]] [[${B}]]`);
    expect(three.citedKeys).toEqual([C, A, B]);
  });

  it("keeps the valid parts and replaces each invalid part visibly, logging it as split", () => {
    const { context: ctx, lines } = context();
    const combined = `[[${A}, ${STRANGER}, aaaa1111]]`;
    const result = validateCitations(`${PROSE} ${combined}.`, ctx);
    expect(result.markdown).toBe(
      `${PROSE} [[${A}]] ${INVALID_CITATION_TEXT} ${INVALID_CITATION_TEXT}.`,
    );
    expect(result.removed).toEqual([
      {
        reason: "not_in_valid_set",
        raw: `[[${STRANGER}]]`,
        key: STRANGER,
        splitFrom: combined,
      },
      { reason: "malformed", raw: "[[aaaa1111]]", splitFrom: combined },
    ]);
    expect(result.figures).toMatchObject({
      markerCount: 3,
      splitMarkerCount: 1,
      resolvedCount: 1,
      notInValidSetCount: 1,
      malformedCount: 1,
      brokenCitationCount: 2,
      resolvedShare: 1,
    });
    expect(lines).toHaveLength(2);
    const logged = lines.map(
      (line) =>
        JSON.parse(line.replace(/^\[research_helper\] /, "")) as Record<
          string,
          unknown
        >,
    );
    expect(logged[0]).toMatchObject({ key: STRANGER, split: true });
    expect(logged[1]).toMatchObject({
      reason: "malformed",
      markerLength: "[[aaaa1111]]".length,
      split: true,
    });
    for (const line of lines) {
      expect(line).not.toContain("Polygenic");
      expect(line).not.toContain("aaaa");
    }
  });

  it("never trims, re-cases or invents a key: such a part is malformed and replaced", () => {
    const { context: ctx } = context();
    const result = validateCitations(
      [
        `[[aaaa1111, ${B}]]`,
        `[[${A} , ${B} ]]`,
        `[[ ${A}, ${B}]]`,
        `[[${A},]]`,
        `[[${A},,${B}]]`,
      ].join("\n"),
      ctx,
    );
    expect(result.markdown).toBe(
      [
        `${INVALID_CITATION_TEXT} [[${B}]]`,
        `[[${A}]] ${INVALID_CITATION_TEXT}`,
        `${INVALID_CITATION_TEXT} [[${B}]]`,
        `[[${A}]] ${INVALID_CITATION_TEXT}`,
        `[[${A}]] ${INVALID_CITATION_TEXT} [[${B}]]`,
      ].join("\n"),
    );
    expect(result.removed.map((r) => r.raw)).toEqual([
      "[[aaaa1111]]",
      `[[${B} ]]`,
      `[[ ${A}]]`,
      "[[]]",
      "[[]]",
    ]);
    expect(result.removed.every((r) => r.reason === "malformed")).toBe(true);
    expect(result.citedKeys).toEqual([B, A]);
    expect(result.figures.markerCount).toBe(
      result.figures.resolvedCount + result.figures.brokenCitationCount,
    );
    expect(result.figures.markerCount).toBe(11);
    expect(result.figures.splitMarkerCount).toBe(5);
  });

  it("does not split at whitespace alone", () => {
    const result = validateCitations(`x [[${A} ${B}]]`, context().context);
    expect(result.markdown).toBe(`x ${INVALID_CITATION_TEXT}`);
    expect(result.figures).toMatchObject({
      markerCount: 1,
      splitMarkerCount: 0,
      malformedCount: 1,
    });
  });

  it("rewrites a dropped duplicate's part to the kept key, and checks the kept key", () => {
    const result = validateCitations(
      `[[${DUP_OF_A}, ${B}; ${DUP_OF_RETRACTED}]]`,
      context().context,
    );
    expect(result.markdown).toBe(`[[${A}]] [[${B}]] ${INVALID_CITATION_TEXT}`);
    expect(result.figures).toMatchObject({
      resolvedCount: 2,
      rewrittenCount: 1,
      notInValidSetCount: 1,
    });
    expect(result.removed[0]).toMatchObject({ key: RETRACTED });
  });

  it("leaves a fenced combined marker as written, unsplit", () => {
    const text = ["```", `[[${A}, ${STRANGER}]]`, "```"].join("\n");
    const result = validateCitations(text, context().context);
    expect(result.markdown).toBe(text);
    expect(result.fenced).toEqual([`[[${A}, ${STRANGER}]]`]);
    expect(result.figures).toMatchObject({
      markerCount: 0,
      splitMarkerCount: 0,
      fencedMarkerCount: 1,
    });
  });

  it("yields text the gate passes and the binder numbers part by part", () => {
    const result = validateCitations(
      `[[${B}, ${STRANGER}]] then [[${A}; ${B}]]`,
      context().context,
    );
    expect(assertAllMarkersResolve(result.markdown, VALID)).toBe(3);
    expect(bindMarkers(result.markdown, VALID, (_k, n) => `[${n}]`)).toBe(
      `[1] ${INVALID_CITATION_TEXT} then [2] [1]`,
    );
  });

  it("is split only by validateCitations: the gate and the binder reject an unsplit one", () => {
    expect(() => assertAllMarkersResolve(`[[${A}, ${B}]]`, VALID)).toThrow(
      "malformed",
    );
    expect(citedKeysOf(`[[${A}, ${B}]]`)).toEqual([]);
    expect(() => bindMarkers(`[[${A}, ${B}]]`, VALID, () => "")).toThrow(
      "malformed",
    );
  });

  it("uses the Korean report's replacement text for an invalid part (item 292(b))", () => {
    const { context: ctx } = context({
      replacement: "[인용 삭제: 잘못된 참조]",
    });
    expect(validateCitations(`[[${A}, ${STRANGER}]]`, ctx).markdown).toBe(
      `[[${A}]] [인용 삭제: 잘못된 참조]`,
    );
  });
});

describe("validateCitations — code fences (docs/12 §10 check 5)", () => {
  it("leaves markers inside a backtick or tilde fence as written, unnumbered, and counts them", () => {
    const { context: ctx, lines } = context();
    const text = [
      `Before [[${B}]].`,
      "```text",
      `[[${STRANGER}]] [[${A}]] [[bad]]`,
      "```",
      `Between [[${C}]].`,
      "  ~~~~",
      `[[${D}]]`,
      "  ~~~",
      `still fenced [[${DUP_OF_A}]]`,
      "~~~~~",
      `After [[${A}]].`,
    ].join("\n");
    const result = validateCitations(text, ctx);
    expect(result.markdown).toBe(text);
    expect(result.fenced).toEqual([
      `[[${STRANGER}]]`,
      `[[${A}]]`,
      "[[bad]]",
      `[[${D}]]`,
      `[[${DUP_OF_A}]]`,
    ]);
    expect(result.citedKeys).toEqual([B, C, A]);
    expect(result.figures).toMatchObject({
      markerCount: 3,
      resolvedCount: 3,
      fencedMarkerCount: 5,
      brokenCitationCount: 0,
    });
    expect(lines).toEqual([]);
  });

  it("runs an unclosed fence to the end of the text", () => {
    const { context: ctx } = context();
    const text = `[[${A}]]\n\`\`\`\n[[${STRANGER}]]\nno close [[${B}]]`;
    const result = validateCitations(text, ctx);
    expect(result.markdown).toBe(text);
    expect(result.figures.fencedMarkerCount).toBe(2);
    expect(result.citedKeys).toEqual([A]);
  });

  it("does not close a backtick fence with tildes, nor with a shorter run", () => {
    const { context: ctx } = context();
    const text = [
      "````",
      "~~~~",
      "```",
      `[[${STRANGER}]]`,
      "````",
      `[[${STRANGER}]]`,
    ].join("\n");
    const result = validateCitations(text, ctx);
    expect(result.figures.fencedMarkerCount).toBe(1);
    expect(result.markdown.endsWith(INVALID_CITATION_TEXT)).toBe(true);

    const tildeInside = ["```", "~~~", `[[${STRANGER}]]`, "```"].join("\n");
    const kept = validateCitations(tildeInside, context().context);
    expect(kept.markdown).toBe(tildeInside);
    expect(kept.figures.fencedMarkerCount).toBe(1);
  });

  it("does not take a one-line ```code``` span, or a closing line with text after it, as a fence", () => {
    const { context: ctx } = context();
    const inline = validateCitations(
      `\`\`\`x\`\`\` [[${A}]]\n[[${STRANGER}]]`,
      ctx,
    );
    expect(inline.figures.fencedMarkerCount).toBe(0);
    expect(inline.figures.brokenCitationCount).toBe(1);

    const notClosed = validateCitations(
      ["```", "``` not a close", `[[${STRANGER}]]`].join("\n"),
      context().context,
    );
    expect(notClosed.figures.fencedMarkerCount).toBe(1);
    expect(notClosed.figures.brokenCitationCount).toBe(0);
  });

  it("finds fences in CRLF text", () => {
    const { context: ctx } = context();
    const text = `[[${A}]]\r\n\`\`\`\r\n[[${STRANGER}]]\r\n\`\`\`\r\n[[${STRANGER}]]\r\n`;
    const result = validateCitations(text, ctx);
    expect(result.figures.fencedMarkerCount).toBe(1);
    expect(result.markdown).toBe(
      `[[${A}]]\r\n\`\`\`\r\n[[${STRANGER}]]\r\n\`\`\`\r\n${INVALID_CITATION_TEXT}\r\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// The final gate
// ---------------------------------------------------------------------------

describe("assertAllMarkersResolve", () => {
  it("returns the number of markers outside fences when every one resolves", () => {
    expect(
      assertAllMarkersResolve(
        `[[${A}]] [[${A}]]\n\`\`\`\n[[x]]\n\`\`\``,
        VALID,
      ),
    ).toBe(2);
    expect(assertAllMarkersResolve("no markers", VALID)).toBe(0);
  });

  it("throws on a non-member, naming the key", () => {
    expect(() =>
      assertAllMarkersResolve(`ok [[${A}]] bad [[${STRANGER}]]`, VALID),
    ).toThrow(`citation marker does not resolve: ${STRANGER}`);
  });

  it("throws on a malformed marker, naming only its length", () => {
    expect(() =>
      assertAllMarkersResolve(`${PROSE} [[Kim 2025]]`, VALID),
    ).toThrow("citation marker does not resolve: malformed (12 characters)");
    expect(() => assertAllMarkersResolve("[[bad]]", VALID)).toThrow(
      "malformed (7 characters)",
    );
  });

  it("rejects a malformed marker even when a caller put that string in the valid set", () => {
    expect(() =>
      assertAllMarkersResolve("[[aaaa1111]]", new Set(["aaaa1111"])),
    ).toThrow("malformed");
  });

  it("rejects a dropped duplicate's key: only validateCitations rewrites it", () => {
    expect(() => assertAllMarkersResolve(`[[${DUP_OF_A}]]`, VALID)).toThrow(
      DUP_OF_A,
    );
  });
});

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

describe("citedKeysOf and bindMarkers — [n] in order of first appearance (docs/06 §10.2)", () => {
  const text = [
    `## 1. Executive Summary`,
    `- [[${C}]] and [[${A}]].`,
    "```",
    `[[${D}]]`,
    "```",
    `- [[${A}]] again, then [[${B}]]; [[${C}]].`,
  ].join("\n");

  it("lists distinct cited keys outside fences in first-appearance order", () => {
    expect(citedKeysOf(text)).toEqual([C, A, B]);
    expect(citedKeysOf(`[[bad]] [[${A}]]`)).toEqual([A]);
  });

  it("renders each marker with its index, the same index for a repeated key, and leaves fenced ones", () => {
    const bound = bindMarkers(text, VALID, (key, n) => `<${n}:${key}>`);
    expect(bound).toBe(
      [
        `## 1. Executive Summary`,
        `- <1:${C}> and <2:${A}>.`,
        "```",
        `[[${D}]]`,
        "```",
        `- <2:${A}> again, then <3:${B}>; <1:${C}>.`,
      ].join("\n"),
    );
  });

  it("agrees with validateCitations' citedKeys on a validated text", () => {
    const { context: ctx } = context();
    const result = validateCitations(
      `[[${DUP_OF_A}]] [[${STRANGER}]] [[${B}]] [[${A}]]`,
      ctx,
    );
    const order: string[] = [];
    bindMarkers(result.markdown, VALID, (key, n) => {
      order[n - 1] = key;
      return "";
    });
    expect(order).toEqual(result.citedKeys);
    expect(result.citedKeys).toEqual([A, B]);
  });

  it("refuses to render a text with an unresolved marker", () => {
    let rendered = 0;
    expect(() =>
      bindMarkers(`[[${A}]] [[${STRANGER}]]`, VALID, () => {
        rendered += 1;
        return "";
      }),
    ).toThrow(STRANGER);
    expect(rendered).toBe(0);
  });
});

describe("ITEM_KEY_RE", () => {
  it("is docs/06 §10.1's key pattern, anchored", () => {
    expect(ITEM_KEY_RE.test(A)).toBe(true);
    expect(ITEM_KEY_RE.test(`${A}X`)).toBe(false);
    expect(ITEM_KEY_RE.test("aaaa1111")).toBe(false);
  });
});

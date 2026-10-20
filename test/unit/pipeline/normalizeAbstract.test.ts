import { describe, expect, it } from "vitest";

import {
  ABSTRACT_PLACEHOLDERS,
  collapseWhitespace,
  normalizeAbstract,
  rejectionReason,
  stripBoilerplate,
  stripInlineMarkup,
  stripNoiseLabels,
} from "../../../src/pipeline/summarize/normalizeAbstract";

/**
 * `docs/06` §3.2's five steps (`P3-T18` step 1). Every abstract below is
 * written for this file; none is copied from a paper.
 */

const STRUCTURED =
  "BACKGROUND: Synthetic widgets are poorly characterised in cold climates. " +
  "METHODS: We measured 120 synthetic widgets at four field sites over two winters. " +
  "RESULTS: Widget output fell by 12% (95% CI 8-16%) below -10 °C. " +
  "CONCLUSIONS: Cold reduces widget output, and site insulation offsets part of the loss.";

describe("normalizeAbstract — the card's Done-when cases (P3-T18)", () => {
  it("keeps RESULTS: and every other structured label", () => {
    const result = normalizeAbstract(STRUCTURED, 100);
    expect(result.rejected).toBeNull();
    expect(result.text).toContain("RESULTS: Widget output fell");
    expect(result.text).toContain("BACKGROUND:");
    expect(result.text).toContain("METHODS:");
    expect(result.text).toContain("CONCLUSIONS:");
  });

  it("strips a trailing copyright line", () => {
    const raw = `${STRUCTURED} © 2024 The Authors. Published by Example Press Ltd. All rights reserved.`;
    const result = normalizeAbstract(raw, 100);
    expect(result.text).toBe(STRUCTURED);
  });

  it('rejects "No abstract available"', () => {
    const result = normalizeAbstract("No abstract available", 0);
    expect(result.text).toBeNull();
    expect(result.rejected).toBe("placeholder");
  });
});

describe("step 1 — stripNoiseLabels", () => {
  it("drops a leading Abstract heading with a colon or a line break", () => {
    expect(stripNoiseLabels("Abstract: Widgets were measured.")).toBe(
      "Widgets were measured.",
    );
    expect(stripNoiseLabels("Abstract\nWidgets were measured.")).toBe(
      "Widgets were measured.",
    );
    expect(stripNoiseLabels("ABSTRACT Widgets were measured.")).toBe(
      "Widgets were measured.",
    );
  });

  it("leaves a sentence that merely starts with the word", () => {
    expect(stripNoiseLabels("Summary statistics were computed.")).toBe(
      "Summary statistics were computed.",
    );
  });

  it("never touches a structured label", () => {
    expect(stripNoiseLabels("BACKGROUND: x. RESULTS: y.")).toBe(
      "BACKGROUND: x. RESULTS: y.",
    );
  });
});

describe("step 2 — collapseWhitespace", () => {
  it("collapses runs, line breaks included, and trims", () => {
    expect(collapseWhitespace("  a\n\nb\t c   d ")).toBe("a b c d");
  });

  it("normalizes to NFC", () => {
    // "e" + COMBINING ACUTE ACCENT → "é" (U+00E9)
    expect(collapseWhitespace("café")).toBe("café");
  });
});

describe("step 3 — stripBoilerplate", () => {
  it.each([
    "© 2023 Example Publishing Group.",
    "Copyright © 2022 Elsevier B.V. All rights reserved.",
    "Copyright 2021 the authors.",
    "(c) 2020 Example Society.",
    "Crown copyright 2019.",
    "This article is protected by copyright. All rights reserved.",
  ])("strips the trailing line %j", (tail) => {
    expect(stripBoilerplate(`Widgets were measured. ${tail}`).text).toBe(
      "Widgets were measured.",
    );
  });

  it("captures a trailing Keywords block separately, split on semicolons", () => {
    const { text, keywords } = stripBoilerplate(
      "Widgets were measured. Keywords: cold climate; widget output; insulation.",
    );
    expect(text).toBe("Widgets were measured.");
    expect(keywords).toEqual(["cold climate", "widget output", "insulation"]);
  });

  it("handles keywords and copyright in either order", () => {
    const a = stripBoilerplate(
      "Widgets were measured. Keywords: a; b. © 2024 Example Press.",
    );
    const b = stripBoilerplate(
      "Widgets were measured. © 2024 Example Press. Keywords: a; b.",
    );
    expect(a).toEqual({ text: "Widgets were measured.", keywords: ["a", "b"] });
    expect(b).toEqual({ text: "Widgets were measured.", keywords: ["a", "b"] });
  });

  it('does not treat "Copyright law" as a copyright line', () => {
    const text = "Copyright law reform changed widget licensing.";
    expect(stripBoilerplate(text).text).toBe(text);
  });

  it("leaves a marker that is far from the end alone", () => {
    const text = `Widgets were measured. © is a symbol we discuss. ${"Body text. ".repeat(60)}`;
    expect(stripBoilerplate(text).text).toBe(text);
  });
});

describe("step 4 — stripInlineMarkup", () => {
  it("removes HTML and JATS inline tags and keeps their text", () => {
    expect(
      stripInlineMarkup(
        "The <i>in vivo</i> yield was 3 m<sup>2</sup> in <jats:italic>E. coli</jats:italic>.",
      ),
    ).toBe("The in vivo yield was 3 m2 in E. coli.");
  });

  it("turns block tags into a word break and decodes entities", () => {
    expect(
      stripInlineMarkup("<p>One &amp; two</p><p>three&nbsp;four</p>"),
    ).toBe("One & two three four");
  });

  it("removes a tag whose attributes carry values", () => {
    expect(stripInlineMarkup('A <span class="gene">TP53</span> variant.')).toBe(
      "A TP53 variant.",
    );
  });

  it("keeps comparison operators that only look like tags", () => {
    expect(stripInlineMarkup("p <0.05 and a <b and c> d")).toBe(
      "p <0.05 and a <b and c> d",
    );
  });
});

describe("step 5 — rejectionReason", () => {
  it.each([
    "No abstract available",
    "No abstract available.",
    "Abstract not available",
    "[No abstract]",
    "N/A",
    "n/a",
  ])("rejects the placeholder %j", (text) => {
    expect(rejectionReason(text, 0)).toBe("placeholder");
  });

  it("lists exactly the four docs/06 placeholders", () => {
    expect(ABSTRACT_PLACEHOLDERS).toHaveLength(4);
  });

  it("rejects under the minimum and accepts at it", () => {
    expect(rejectionReason("x".repeat(249), 250)).toBe("too_short");
    expect(rejectionReason("x".repeat(250), 250)).toBeNull();
  });

  it("rejects the empty string even with a minimum of zero", () => {
    expect(rejectionReason("", 0)).toBe("empty");
  });
});

describe("normalizeAbstract — the steps run in order", () => {
  it("a placeholder wrapped in markup and a heading is still a placeholder", () => {
    const result = normalizeAbstract(
      "Abstract:\n<p>No abstract available.</p>",
      0,
    );
    expect(result.rejected).toBe("placeholder");
  });

  it("copyright inside a closing paragraph tag is stripped", () => {
    const result = normalizeAbstract(
      `<p>${STRUCTURED}</p><p>© 2024 Example Press.</p>`,
      100,
    );
    expect(result.text).toBe(STRUCTURED);
  });

  it("an abstract that is only boilerplate is rejected as empty", () => {
    expect(normalizeAbstract("© 2024 Example Press.", 0).rejected).toBe(
      "empty",
    );
  });

  it("returns keywords alongside the text", () => {
    const result = normalizeAbstract(
      `${STRUCTURED} Keywords: widgets, cold`,
      100,
    );
    expect(result.text).toBe(STRUCTURED);
    expect(result.keywords).toEqual(["widgets", "cold"]);
  });
});

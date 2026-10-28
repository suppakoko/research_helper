/**
 * `P3-T25` steps 4–5 — `docs/06` §12.1 L3's `checkGrounding` and
 * `docs/12` §18.4's numeral invariant (`src/pipeline/summarize/grounding.ts`).
 *
 * Pure functions over synthetic text written here; no model, no network.
 */

import { describe, expect, it } from "vitest";

import type { KeyFinding } from "../../../src/model/summary";
import {
  checkGrounding,
  checkNumeralInvariants,
  EFFECT_SIZE_NUMERAL_WARNING,
  GROUNDING_LOW_SCORE,
  GROUNDING_TOKEN_OVERLAP_MIN,
  numeralInSource,
  numeralsIn,
  POPULATION_SIZE_NUMERAL_WARNING,
  tokenOverlap,
} from "../../../src/pipeline/summarize/grounding";

const SOURCE = [
  "Background. Lipid nanoparticles deliver messenger RNA to the liver.",
  "Results. Treatment reduced the tumour volume by 42% compared with",
  "control (hazard ratio 0.62, 95% CI 0.48-0.79; p = 0.003) in n = 1,204",
  "patients. The ﬁnal cohort was followed for twelve months.",
].join("\n");

function finding(verbatimSupport: string | null, statement = "s"): KeyFinding {
  return {
    statement,
    direction: "positive",
    evidenceStrength: "moderate",
    verbatimSupport,
  };
}

describe("checkGrounding — docs/06 §12.1", () => {
  it("scores 1.0 when every quotation is present, across whitespace and case drift", () => {
    const result = checkGrounding(
      {
        keyFindings: [
          finding("treatment reduced the tumour   volume by 42%"),
          finding("Lipid nanoparticles deliver messenger RNA to the liver."),
        ],
      },
      SOURCE,
    );
    expect(result).toStrictEqual({ score: 1, missing: [] });
  });

  it("finds a quotation across a ligature through the token overlap", () => {
    // The source has the ligature ﬁ; the model wrote plain "fi".
    const quote = "The final cohort was followed for twelve months.";
    expect(SOURCE.toLowerCase().includes(quote.toLowerCase())).toBe(false);
    expect(tokenOverlap(quote, SOURCE)).toBeGreaterThanOrEqual(
      GROUNDING_TOKEN_OVERLAP_MIN,
    );
    expect(
      checkGrounding({ keyFindings: [finding(quote)] }, SOURCE).score,
    ).toBe(1);
  });

  it("scores below 0.5 when the quotations are absent, and lists the statements", () => {
    const result = checkGrounding(
      {
        keyFindings: [
          finding("The vaccine prevented all infections in mice.", "a"),
          finding("Adverse events were rare and mild overall.", "b"),
          finding("treatment reduced the tumour volume", "c"),
        ],
      },
      SOURCE,
    );
    expect(result.score).toBeCloseTo(1 / 3, 10);
    expect(result.score).toBeLessThan(GROUNDING_LOW_SCORE);
    expect(result.missing).toStrictEqual(["a", "b"]);
  });

  it("counts a null quotation as unsupported, and has no score without findings", () => {
    expect(
      checkGrounding({ keyFindings: [finding(null, "x")] }, SOURCE),
    ).toStrictEqual({ score: 0, missing: ["x"] });
    expect(checkGrounding({ keyFindings: [] }, SOURCE)).toStrictEqual({
      score: null,
      missing: [],
    });
  });
});

describe("tokenOverlap — docs/06 §12.1's note of 2026-10-28, item (1)", () => {
  it("is local: words scattered across the text do not make a quotation", () => {
    // Every word below occurs in SOURCE, but not together.
    const scattered = "liver patients months control cohort messenger";
    expect(tokenOverlap(scattered, SOURCE)).toBeLessThan(
      GROUNDING_TOKEN_OVERLAP_MIN,
    );
  });

  it("is 1 for a contiguous run, and 0 for a needle with no token", () => {
    expect(tokenOverlap("reduced the tumour volume", SOURCE)).toBe(1);
    expect(tokenOverlap("— …", SOURCE)).toBe(0);
  });

  it("tolerates one extractor split inside a long quotation", () => {
    const hay =
      "the protein was tar\ngeted to the outer membrane of every cell in the sample";
    const quote =
      "the protein was targeted to the outer membrane of every cell in the sample";
    expect(tokenOverlap(quote, hay)).toBeGreaterThanOrEqual(
      GROUNDING_TOKEN_OVERLAP_MIN,
    );
  });
});

describe("checkNumeralInvariants — docs/12 §18.4", () => {
  it("reads numerals with their separators", () => {
    expect(numeralsIn("0.62 (95% CI 0.48-0.79)")).toStrictEqual([
      "0.62",
      "95",
      "0.48",
      "0.79",
    ]);
    expect(numeralsIn("n = 1,204")).toStrictEqual(["1,204"]);
  });

  it("does not find a numeral inside a longer one", () => {
    expect(numeralInSource("0.62", SOURCE)).toBe(true);
    expect(numeralInSource("62", SOURCE)).toBe(false);
    expect(numeralInSource("0.6", SOURCE)).toBe(false);
    expect(numeralInSource("1,204", SOURCE)).toBe(true);
    expect(numeralInSource("204", SOURCE)).toBe(false);
  });

  it("passes values copied from the source and warns once per kind otherwise, changing nothing", () => {
    const ok = checkNumeralInvariants(
      {
        effectSizes: [
          { metric: "hazard ratio", value: "0.62 (95% CI 0.48-0.79)" },
        ],
        population: { kind: "human", description: null, size: "n = 1,204" },
      },
      SOURCE,
    );
    expect(ok).toStrictEqual({
      effectSizes: [],
      populationSize: [],
      warnings: [],
    });

    const summary = {
      effectSizes: [
        { metric: "hazard ratio", value: "0.63" },
        { metric: "odds ratio", value: "1.9" },
      ],
      population: {
        kind: "human" as const,
        description: null,
        size: "n = 1204",
      },
    };
    const frozen = JSON.stringify(summary);
    const bad = checkNumeralInvariants(summary, SOURCE);
    expect(bad.effectSizes).toStrictEqual(["0.63", "1.9"]);
    expect(bad.populationSize).toStrictEqual(["1204"]);
    expect(bad.warnings).toStrictEqual([
      EFFECT_SIZE_NUMERAL_WARNING,
      POPULATION_SIZE_NUMERAL_WARNING,
    ]);
    expect(JSON.stringify(summary)).toBe(frozen);
  });
});

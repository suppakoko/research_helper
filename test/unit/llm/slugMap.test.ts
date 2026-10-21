/**
 * `P3-T13` step 1: `toOpenRouterSlug`, `docs/03` §9.4's native-ID → slug rule.
 * The catalogue's use of the slug is tested in `pricing.test.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  OPENROUTER_AUTHOR_PREFIX,
  toOpenRouterSlug,
} from "../../../src/llm/shared/slugMap";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** `docs/03` §9.4's "Native Anthropic ID | OpenRouter slug" rows. */
function documentedAnthropicRows(): [string, string][] {
  const doc = readFileSync(
    resolve(ROOT, "docs/03-llm-provider-integration.md"),
    "utf8",
  );
  const start = doc.indexOf("| Native Anthropic ID | OpenRouter slug |");
  expect(start).toBeGreaterThan(-1);
  const rows: [string, string][] = [];
  for (const line of doc.slice(start).split(/\r?\n/).slice(2)) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|$/.exec(line.trim());
    if (match === null) break;
    rows.push([match[1] as string, match[2] as string]);
  }
  return rows;
}

describe("toOpenRouterSlug — docs/03 §9.4", () => {
  it('maps ("anthropic", "claude-haiku-4-5") to "anthropic/claude-haiku-4.5"', () => {
    expect(toOpenRouterSlug("anthropic", "claude-haiku-4-5")).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });

  it("reproduces every row of §9.4's Anthropic table, read from the document", () => {
    const rows = documentedAnthropicRows();
    expect(rows).toHaveLength(4);
    for (const [native, slug] of rows) {
      expect(toOpenRouterSlug("anthropic", native)).toBe(slug);
    }
  });

  it("prefixes OpenAI and Google IDs with the author, unchanged", () => {
    expect(OPENROUTER_AUTHOR_PREFIX).toEqual({
      openai: "openai",
      gemini: "google",
      anthropic: "anthropic",
    });
    expect(toOpenRouterSlug("openai", "gpt-5.6-terra")).toBe(
      "openai/gpt-5.6-terra",
    );
    expect(toOpenRouterSlug("gemini", "gemini-3.8-flash")).toBe(
      "google/gemini-3.8-flash",
    );
    // No dot rule outside Anthropic: a trailing digit pair stays as it is.
    expect(toOpenRouterSlug("openai", "o-4-5")).toBe("openai/o-4-5");
    expect(toOpenRouterSlug("gemini", "gemma-4-2")).toBe("google/gemma-4-2");
  });

  it("strips Gemini's models/ prefix before prefixing (docs/03 §9.3)", () => {
    expect(toOpenRouterSlug("gemini", "models/gemini-3.8-flash")).toBe(
      "google/gemini-3.8-flash",
    );
  });

  it("passes an OpenRouter model ID through: it already is a slug", () => {
    expect(toOpenRouterSlug("openrouter", "anthropic/claude-sonnet-5")).toBe(
      "anthropic/claude-sonnet-5",
    );
    expect(toOpenRouterSlug("openrouter", "anthropic/claude-haiku-4-5")).toBe(
      "anthropic/claude-haiku-4-5",
    );
  });

  it("rewrites only a trailing pair of one- or two-digit parts", () => {
    expect(toOpenRouterSlug("anthropic", "claude-sonnet-4-5")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
    expect(toOpenRouterSlug("anthropic", "claude-opus-10-12")).toBe(
      "anthropic/claude-opus-10.12",
    );
    // A dated snapshot: no documented slug, so no guess.
    expect(toOpenRouterSlug("anthropic", "claude-haiku-4-5-20251001")).toBe(
      "anthropic/claude-haiku-4-5-20251001",
    );
    // A pair that is not trailing is left alone.
    expect(toOpenRouterSlug("anthropic", "claude-3-5-sonnet")).toBe(
      "anthropic/claude-3-5-sonnet",
    );
    expect(toOpenRouterSlug("anthropic", "claude-opus-5")).toBe(
      "anthropic/claude-opus-5",
    );
  });

  it("trims, and returns undefined for an empty ID", () => {
    expect(toOpenRouterSlug("anthropic", "  claude-fable-5-1 ")).toBe(
      "anthropic/claude-fable-5.1",
    );
    expect(toOpenRouterSlug("openai", "")).toBeUndefined();
    expect(toOpenRouterSlug("gemini", "models/")).toBeUndefined();
    expect(toOpenRouterSlug("openrouter", "  ")).toBeUndefined();
  });
});

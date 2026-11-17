/**
 * `P7-T17`: every provider-policy line the pane shows has a date and a source,
 * and words only what `docs/09` §3.3's re-verification of that date records.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import {
  POLICY_NOTES,
  POLICY_NOTES_AS_OF,
} from "../../../src/llm/shared/policyNotes";
import { PREFERENCES_L10N } from "../../../src/ui/prefs/preferencesPane";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const FTL = readFileSync(
  resolve(root, "addon/locale/en-US/research-helper-mainWindow.ftl"),
  "utf8",
);
const DOCS_09 = readFileSync(
  resolve(root, "docs/09-security-privacy-and-api-keys.md"),
  "utf8",
);

/** `docs/09` §3.3's re-verification table of {@link POLICY_NOTES_AS_OF}. */
function reverification(): string {
  const start = DOCS_09.indexOf(
    `**Re-verified ${POLICY_NOTES_AS_OF} (\`plan/10\` \`P7-T17\``,
  );
  expect(start, "docs/09 §3.3's re-verification note").toBeGreaterThan(-1);
  const end = DOCS_09.indexOf(
    "\n\n",
    DOCS_09.indexOf("**Kept out of the pane", start),
  );
  return DOCS_09.slice(start, end);
}

/** One en-US message's text, continuation lines included. */
function message(id: string): string {
  const match = new RegExp(`^${id} =(.*(?:\\n {4}.*)*)`, "m").exec(FTL);
  expect(match, id).not.toBeNull();
  return match![1]!;
}

describe("P7-T17 — POLICY_NOTES: every line has a date and a source", () => {
  it("gives every row an ISO date, the re-verification's, and at least one https source", () => {
    expect(POLICY_NOTES.length).toBeGreaterThan(0);
    expect(POLICY_NOTES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const note of POLICY_NOTES) {
      expect(note.asOf, note.messageId).toBe(POLICY_NOTES_AS_OF);
      expect(note.sourceUrls.length, note.messageId).toBeGreaterThan(0);
      for (const url of note.sourceUrls) {
        expect(new URL(url).protocol, url).toBe("https:");
      }
    }
  });

  it("takes every source from docs/09 §3.3's re-verification table of that date", () => {
    const table = reverification();
    for (const note of POLICY_NOTES) {
      for (const url of note.sourceUrls) {
        expect(table, url).toContain(`(${url})`);
      }
    }
  });

  it("covers the four LLM providers, one line each but Gemini's two tiers, with no id twice", () => {
    expect([...new Set(POLICY_NOTES.map((n) => n.provider))].sort()).toEqual([
      "anthropic",
      "gemini",
      "openai",
      "openrouter",
    ]);
    const ids = POLICY_NOTES.map((n) => n.messageId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(POLICY_NOTES.filter((n) => n.provider === "gemini")).toHaveLength(2);
  });

  it("names a pane message for every row, shipped in en-US with its $date", () => {
    const pane = new Set<string>(Object.values(PREFERENCES_L10N));
    const declared = new Set<string>(MAIN_WINDOW_MESSAGE_IDS);
    for (const note of POLICY_NOTES) {
      expect(pane.has(note.messageId), note.messageId).toBe(true);
      expect(declared.has(note.messageId), note.messageId).toBe(true);
      expect(message(note.messageId)).toMatch(/Verified \{ \$date \}\.$/);
    }
  });

  it("claims no protection the pages do not state: no 'never stored', 'zero retention' or 'deleted immediately'", () => {
    for (const note of POLICY_NOTES) {
      expect(message(note.messageId), note.messageId).not.toMatch(
        /never (stored|kept|retained)|zero[- ]retention|immediately deleted|deleted immediately|guarantee/i,
      );
    }
  });

  it("keeps the configurable 7/14/28/55-day window out of the pane (docs/09 §3.3's correction of this date)", () => {
    for (const note of POLICY_NOTES) {
      expect(message(note.messageId)).not.toMatch(/\b(7|14|28)\b.*days/);
    }
  });
});

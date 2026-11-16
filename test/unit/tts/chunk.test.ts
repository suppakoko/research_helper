/**
 * `plan/09` `P6-T09` — the chunker (`src/tts/chunk.ts`), layer 1: plain Node,
 * no I/O. The two long samples are generated here from fixed word banks with
 * a seeded generator, so they are the same on every run and hold no third
 * party's text.
 */

import { describe, expect, it } from "vitest";

import type { Logger } from "../../../src/core/logger";
import type { AudioChunk } from "../../../src/model/audio";
import { chunkScript, splitSentences } from "../../../src/tts/chunk";
import { GEMINI_TTS_MAX_CHUNK_CHARS } from "../../../src/tts/geminiTts";

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

/** A small deterministic generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("empty bank");
  return item;
}

const EN_WORDS = [
  "delivery",
  "lipid",
  "nanoparticles",
  "studies",
  "reported",
  "higher",
  "efficiency",
  "across",
  "models",
  "the",
  "of",
  "in",
  "a",
  "with",
  "and",
  "trials",
  "showed",
  "that",
  "researchers",
  "compared",
  "outcomes",
  "methods",
  "editing",
  "cells",
  "results",
  "suggest",
  "approach",
  "large",
  "cohort",
  "measured",
  "response",
  "dose",
  "groups",
  "review",
  "evidence",
];

const EN_INSERTS = [
  "Smith et al. reported",
  "for example, e.g. in mice,",
  "as Kim et al. showed,",
  "i.e. the treated group",
  "see Fig. 2",
  "versus vs. control",
];

/** One English sentence of `words` words, sometimes with a guarded abbreviation. */
function englishSentence(random: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) out.push(pick(random, EN_WORDS));
  if (random() < 0.5) {
    out.splice(Math.floor(random() * out.length), 0, pick(random, EN_INSERTS));
  }
  const first = out[0] ?? "the";
  out[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return `${out.join(" ")}${pick(random, [".", ".", ".", "?", "!"])}`;
}

function countWords(text: string): number {
  return text.split(/\s+/u).filter((w) => w !== "").length;
}

/**
 * At least 1,500 English words in paragraphs of 1–9 sentences, so some
 * paragraphs fit one chunk and some must be split on sentences; one paragraph
 * carries a single sentence far over the ceiling.
 */
function englishSample(): string {
  const random = seeded(1500);
  const paragraphs: string[] = [];
  while (countWords(paragraphs.join(" ")) < 1500) {
    const n = 1 + Math.floor(random() * 9);
    const sentences: string[] = [];
    for (let i = 0; i < n; i += 1) {
      sentences.push(englishSentence(random, 8 + Math.floor(random() * 22)));
    }
    paragraphs.push(sentences.join(" "));
  }
  const long = Array.from({ length: 40 }, (_, i) =>
    i % 6 === 5 ? "and the cohort grew," : "the treated cells responded",
  ).join(" ");
  paragraphs.splice(3, 0, `In one trial ${long} at last.`);
  return paragraphs.join("\n\n");
}

/** Hangul syllables U+AC00–U+D7A3. */
function hangul(random: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(0xac00 + Math.floor(random() * 11172));
  }
  return out;
}

function countSyllables(text: string): number {
  return Array.from(text).filter((c) => c >= "가" && c <= "힣").length;
}

/** At least 4,000 Hangul syllables, with embedded English terms. */
function koreanSample(): string {
  const random = seeded(4000);
  const paragraphs: string[] = [];
  while (countSyllables(paragraphs.join("")) < 4000) {
    const n = 1 + Math.floor(random() * 8);
    const sentences: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const words: string[] = [];
      const w = 4 + Math.floor(random() * 10);
      for (let k = 0; k < w; k += 1) {
        words.push(
          random() < 0.1
            ? pick(random, [
                "machine learning",
                "CRISPR-Cas9",
                "e.g.",
                "transformer",
              ])
            : hangul(random, 1 + Math.floor(random() * 4)),
        );
      }
      sentences.push(
        `${words.join(" ")}${pick(random, ["다.", "까?", "다!"])}`,
      );
    }
    paragraphs.push(sentences.join(" "));
  }
  return paragraphs.join("\n\n");
}

function joined(chunks: readonly AudioChunk[]): string {
  return chunks.map((c) => c.text + c.separator).join("");
}

/** Every position `needle` starts at in `text`. */
function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  for (
    let at = text.indexOf(needle);
    at >= 0;
    at = text.indexOf(needle, at + 1)
  ) {
    out.push(at);
  }
  return out;
}

/** The script offsets where each chunk's text ends. */
function boundaries(chunks: readonly AudioChunk[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const chunk of chunks) {
    out.push(at + chunk.text.length);
    at += chunk.text.length + chunk.separator.length;
  }
  return out;
}

function capturingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const write = (msg: string, ctx?: Record<string, unknown>): void => {
    lines.push(`${msg} ${JSON.stringify(ctx ?? {})}`);
  };
  const logger: Logger & { lines: string[] } = {
    lines,
    child: () => logger,
    error: write,
    warn: write,
    info: write,
    debug: write,
    time: (_msg, fn) => fn(),
  };
  return logger;
}

// ---------------------------------------------------------------------------
// The two samples (Done when, lines 1 and 2)
// ---------------------------------------------------------------------------

describe("chunkScript on the 1,500-word English sample", () => {
  const script = englishSample();
  const logger = capturingLogger();
  const chunks = chunkScript(script, { language: "en", logger });

  it("is a 1,500-word sample with guarded abbreviations", () => {
    expect(countWords(script)).toBeGreaterThanOrEqual(1500);
    expect(occurrences(script, "et al.").length).toBeGreaterThanOrEqual(3);
    expect(occurrences(script, "e.g.").length).toBeGreaterThanOrEqual(3);
  });

  it("joins back to the script exactly", () => {
    expect(joined(chunks)).toBe(script);
  });

  it("has no chunk over 900 characters, and none empty", () => {
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.chars).toBe(chunk.text.length);
      expect(chunk.chars).toBeLessThanOrEqual(GEMINI_TTS_MAX_CHUNK_CHARS.en);
      expect(chunk.text.trim()).not.toBe("");
    }
  });

  it("never ends a chunk inside et al. or e.g.", () => {
    const cuts = boundaries(chunks);
    for (const needle of ["et al.", "e.g.", "i.e.", "Fig. 2", "vs."]) {
      for (const at of occurrences(script, needle)) {
        for (const cut of cuts) {
          expect(cut <= at || cut >= at + needle.length).toBe(true);
        }
      }
      for (const chunk of chunks) {
        expect(chunk.text.endsWith(needle.slice(0, -1))).toBe(false);
      }
    }
  });

  it("separates chunks with whitespace only, the last with nothing", () => {
    chunks.slice(0, -1).forEach((c) => expect(c.separator).toMatch(/^\s+$/u));
    expect(chunks.at(-1)?.separator).toBe("");
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it("splits the one over-long sentence at a clause break, and logs no text", () => {
    expect(logger.lines.length).toBeGreaterThan(0);
    expect(logger.lines.every((l) => l.includes('"kind":"clause"'))).toBe(true);
    expect(logger.lines.join("\n")).not.toMatch(/cohort|treated/u);
  });
});

describe("chunkScript on the 4,000-syllable Korean sample", () => {
  const script = koreanSample();
  const chunks = chunkScript(script, { language: "ko" });

  it("is a 4,000-syllable sample", () => {
    expect(countSyllables(script)).toBeGreaterThanOrEqual(4000);
  });

  it("joins back exactly, with no chunk over 450 characters", () => {
    expect(joined(chunks)).toBe(script);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.chars).toBeLessThanOrEqual(GEMINI_TTS_MAX_CHUNK_CHARS.ko);
    }
  });

  it("ends every chunk at a sentence end", () => {
    for (const chunk of chunks) expect(chunk.text).toMatch(/[.?!]$/u);
  });
});

// ---------------------------------------------------------------------------
// The rules, one by one
// ---------------------------------------------------------------------------

describe("chunkScript's packing", () => {
  it("packs short paragraphs into one chunk with their own break", () => {
    const script = "One.\n\nTwo.\n \nThree.";
    const chunks = chunkScript(script, { language: "en" });
    expect(chunks).toEqual([
      { index: 0, text: script, chars: script.length, separator: "" },
    ]);
  });

  it("closes a chunk before a paragraph that would take it over the ceiling", () => {
    const a = "A".repeat(30) + ".";
    const b = "B".repeat(30) + ".";
    const chunks = chunkScript(`${a}\n\n${b}`, {
      language: "en",
      maxChars: 40,
    });
    expect(chunks.map((c) => c.text)).toEqual([a, b]);
    expect(chunks[0]?.separator).toBe("\n\n");
  });

  it("closes a long paragraph at its own end, so the next paragraph starts a chunk", () => {
    const long = "Aa aa aa. Bb bb bb. Cc cc cc.";
    const chunks = chunkScript(`${long}\n\nDd.`, {
      language: "en",
      maxChars: 20,
    });
    expect(chunks.map((c) => c.text)).toEqual([
      "Aa aa aa. Bb bb bb.",
      "Cc cc cc.",
      "Dd.",
    ]);
  });

  it("does not fill a short chunk past the ceiling (the sketch's minChars is not applied)", () => {
    const chunks = chunkScript("Ab. " + "C".repeat(18) + ".", {
      language: "en",
      maxChars: 20,
    });
    expect(chunks.map((c) => c.text)).toEqual(["Ab.", "C".repeat(18) + "."]);
  });

  it("keeps leading and trailing whitespace in the join", () => {
    const script = "\n  Hello there.  \n";
    const chunks = chunkScript(script, { language: "en" });
    expect(joined(chunks)).toBe(script);
    expect(chunks.at(-1)?.separator).toBe("  \n");
  });

  it("yields no chunk for a script with no visible text", () => {
    expect(chunkScript("", { language: "en" })).toEqual([]);
    expect(chunkScript(" \n\n ", { language: "ko" })).toEqual([]);
  });

  it("refuses a ceiling that is not a positive integer", () => {
    for (const maxChars of [0, -1, 1.5, Number.NaN]) {
      expect(() => chunkScript("a.", { language: "en", maxChars })).toThrow(
        RangeError,
      );
    }
  });

  it("reproduces arbitrary scripts exactly, within the ceiling (seeded fuzz)", () => {
    const random = seeded(7);
    const parts = [
      "word",
      "et al.",
      "e.g.",
      ",",
      ";",
      ".",
      "?",
      "!",
      " ",
      "  ",
      "\n",
      "\n\n",
      "\n \n",
      "가나다",
      "3.5",
      '"',
      ")",
    ];
    for (let round = 0; round < 300; round += 1) {
      let script = "";
      const n = Math.floor(random() * 120);
      for (let i = 0; i < n; i += 1) script += pick(random, parts);
      const maxChars = 8 + Math.floor(random() * 60);
      const language = random() < 0.5 ? "en" : "ko";
      const chunks = chunkScript(script, { language, maxChars });
      if (script.trim() === "") {
        expect(chunks).toEqual([]);
        continue;
      }
      expect(joined(chunks)).toBe(script);
      for (const chunk of chunks.slice(1)) {
        expect(chunk.chars).toBeLessThanOrEqual(maxChars);
      }
    }
  });
});

describe("a sentence over the ceiling (P6-T09 step 2)", () => {
  it("splits after the last comma that keeps the piece within the ceiling", () => {
    const logger = capturingLogger();
    const chunks = chunkScript("One two, three four, five six seven eight.", {
      language: "en",
      maxChars: 22,
      logger,
    });
    expect(chunks.map((c) => c.text)).toEqual([
      "One two, three four,",
      "five six seven eight.",
    ]);
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]).toContain('"kind":"clause"');
    expect(logger.lines[0]).not.toContain("three");
  });

  it("splits after a semicolon too, but not after a comma inside a number", () => {
    const chunks = chunkScript("Alpha beta; gamma 1,000 delta epsilon.", {
      language: "en",
      maxChars: 25,
    });
    expect(chunks[0]?.text).toBe("Alpha beta;");
  });

  it("falls back to the last space, never inside et al., and logs it", () => {
    const logger = capturingLogger();
    const script = "Aaaa bbbb cccc et al. dddd eeee.";
    const chunks = chunkScript(script, {
      language: "en",
      maxChars: 18,
      logger,
    });
    expect(joined(chunks)).toBe(script);
    expect(chunks.map((c) => c.text)).toEqual([
      "Aaaa bbbb cccc",
      "et al. dddd eeee.",
    ]);
    expect(logger.lines[0]).toContain('"kind":"space"');
  });

  it("cuts at the ceiling only when there is no break at all, never inside a surrogate pair", () => {
    const logger = capturingLogger();
    const script = `${"가".repeat(5)}\u{1F600}${"나".repeat(5)}.`;
    const chunks = chunkScript(script, { language: "ko", maxChars: 6, logger });
    expect(joined(chunks)).toBe(script);
    for (const chunk of chunks) {
      expect(chunk.chars).toBeLessThanOrEqual(6);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
    expect(logger.lines.some((l) => l.includes('"kind":"length"'))).toBe(true);
  });
});

describe("splitSentences (docs/04 §5.2)", () => {
  it("keeps guarded abbreviations inside their sentence", () => {
    expect(
      splitSentences(
        "Smith et al. found more. See Fig. 2 for e.g. mice, i.e. all. Dr. Lee agreed!",
      ),
    ).toEqual([
      "Smith et al. found more.",
      "See Fig. 2 for e.g. mice, i.e. all.",
      "Dr. Lee agreed!",
    ]);
  });

  it("does not split a decimal or a period followed by a letter", () => {
    expect(splitSentences("It rose 3.5 times. Next one.")).toEqual([
      "It rose 3.5 times.",
      "Next one.",
    ]);
  });

  it("keeps runs of marks and closing quotes with the sentence", () => {
    expect(splitSentences('He asked "why?!" Then (it ended.) Done')).toEqual([
      'He asked "why?!"',
      "Then (it ended.)",
      "Done",
    ]);
  });

  it("ends Korean sentences at . ? and ! and applies no English guard", () => {
    expect(splitSentences("결과가 좋다. 왜 그런가? 놀랍다! 끝", "ko")).toEqual([
      "결과가 좋다.",
      "왜 그런가?",
      "놀랍다!",
      "끝",
    ]);
    expect(splitSentences("참고 cf. 다음이다.", "ko")).toEqual([
      "참고 cf.",
      "다음이다.",
    ]);
    expect(splitSentences("참고 cf. 다음이다.", "en")).toEqual([
      "참고 cf. 다음이다.",
    ]);
  });

  it("does not treat the full-width marks as Korean sentence ends", () => {
    expect(splitSentences("하나。 둘", "ko")).toEqual(["하나。 둘"]);
  });

  it("returns nothing for blank text", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

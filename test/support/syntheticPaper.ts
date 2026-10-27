/**
 * Synthetic papers for the chunker and estimate tests (`P3-T23`; owner,
 * `plan/00` §6 item 299(b)). Deterministic English sentences whose `estTokens`
 * is known, laid out as `docs/06` §3.6's acquisition: the abstract preamble,
 * a blank line, then sections with offsets. SYNTHETIC: no real paper text.
 */

import type { ChunkableSource } from "../../src/llm/shared/chunking";
import { estTokens } from "../../src/llm/shared/tokenEstimate";
import type { AcquiredSection, ImradSection } from "../../src/model/summary";

/** The raw heuristic: no model id, so no preference is read. */
const count = (text: string): number => estTokens(text);

const WORDS = [
  "cells",
  "were",
  "measured",
  "under",
  "steady",
  "conditions",
  "and",
  "the",
  "signal",
  "rose",
  "with",
  "dose",
  "across",
  "every",
  "replicate",
  "sample",
];

/** Deterministic sentences: a capital first word, a full stop, 12 words. */
export function sentence(seed: number): string {
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    words.push(WORDS[(seed * 7 + i * 3) % WORDS.length] as string);
  }
  const first = words[0] as string;
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return `${words.join(" ")}.`;
}

/** Flowing text: paragraphs of six sentences, one paragraph per line. */
export function flowing(tokens: number, seed = 0, perParagraph = 6): string {
  let out = "";
  let s = seed;
  while (count(out) < tokens) {
    const para: string[] = [];
    for (let i = 0; i < perParagraph; i++) para.push(sentence(s++));
    out += `${para.join(" ")}\n`;
  }
  return out;
}

/** Hard-wrapped text: the same sentences, one `\n` per ~80-character line. */
export function hardWrapped(tokens: number): string {
  const words = flowing(tokens).replace(/\n/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > 80) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return `${lines.join("\n")}\n`;
}

export interface SectionSpec {
  readonly heading: string;
  readonly labels: readonly ImradSection[];
  readonly tokens: number;
}

/**
 * A Tier 2-shaped source: the abstract preamble, a blank line, then the
 * sections in document order, with offsets as `docs/06` §3.6 defines them.
 */
export function paper(
  abstract: string | null,
  specs: readonly SectionSpec[],
  sectionAware = true,
): ChunkableSource {
  let body = "";
  const offset = abstract === null ? 0 : abstract.length + 2;
  const sections: AcquiredSection[] = [];
  specs.forEach((spec, i) => {
    const start = offset + body.length;
    const text = `${spec.heading}\n${flowing(spec.tokens, i * 1_000)}`;
    body += text;
    sections.push({
      imrad: spec.labels[0] as ImradSection,
      labels: spec.labels,
      heading: spec.heading,
      text,
      start,
      end: start + text.length,
    });
  });
  const text = abstract === null ? body : `${abstract}\n\n${body}`;
  return { itemKey: "ABCD1234", abstract, sections, sectionAware, text };
}

/** A 60 000-token paper with every §5.3 label and two 0 % ones. */
export const SIXTY_K: readonly SectionSpec[] = [
  { heading: "Running title and authors", labels: ["other"], tokens: 1_000 },
  { heading: "Abstract", labels: ["abstract"], tokens: 2_700 },
  { heading: "1. Introduction", labels: ["introduction"], tokens: 9_000 },
  { heading: "2. Background", labels: ["background"], tokens: 5_000 },
  { heading: "3. Methods", labels: ["methods"], tokens: 12_000 },
  { heading: "4. Results", labels: ["results"], tokens: 15_000 },
  { heading: "5. Discussion", labels: ["discussion"], tokens: 9_000 },
  { heading: "6. Limitations", labels: ["limitations"], tokens: 3_000 },
  { heading: "7. Conclusions", labels: ["conclusion"], tokens: 3_000 },
];

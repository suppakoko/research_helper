/**
 * Regenerate `plan/00-task-index.md` §4's six tables, and its header counts,
 * from the task cards in `plan/01`–`plan/04`, `plan/07` and `plan/08`.
 *
 * **Phase 4 added 2026-10-26** (`plan/00` §6 item 286): its cards live in
 * `plan/07-phase-4-trend-report.md` — numbered `07` because `05` and `06`
 * were taken — so the file list is no longer `plan/0<phase + 1>`.
 *
 * **Phase 5 added 2026-11-01** (`plan/00` §6 items 320, 321, 323 and 325):
 * its cards live in `plan/08-phase-5-related-papers.md`, numbered `08`
 * because `05`–`07` were taken.
 *
 * **Why this exists.** `plan/00-task-index.md` §7 already says those tables are
 * *derived* from the cards' `ID`, `Depends on`, `Estimate` and `Human gate`
 * rows, and that they must be re-derived after editing any card. Nobody was
 * re-deriving them. Measured 2026-10-12, after `P1-T23`'s report found the
 * header counts stale: Phase 0's table was missing 2 of its 35 cards, Phase 1's
 * **23 of 46**, Phase 2's 7 of 25, and Phase 1's `DONE` ticks had never been
 * applied at all. A rule nobody can run is a rule that rots; this is the rule
 * as a command.
 *
 * **Run it** with `npm run index:derive`, from the repository root, after
 * editing any card. It rewrites only the six tables and the header's counts,
 * and leaves every other word of that file alone.
 *
 * **What it does not do.** It never changes a card, and it never invents a
 * state: a row is ticked if and only if the card's `State` begins with `DONE`,
 * and the gate marker is set if and only if the card's `Human gate` cell begins
 * with the exact spelling `plan/README.md` §4 requires. If a card's four fields
 * cannot be read, it exits non-zero and names the card rather than guessing.
 */

import { readFileSync, writeFileSync } from "node:fs";

/** One phase file, its card-id prefix, and its heading in the index. */
interface PhaseSource {
  readonly file: string;
  readonly prefix: string;
  readonly heading: string;
}

const PHASES: readonly PhaseSource[] = [
  {
    file: "plan/01-phase-0-toolchain-spike.md",
    prefix: "P0",
    heading: "### Phase 0",
  },
  { file: "plan/02-phase-1-pubmed.md", prefix: "P1", heading: "### Phase 1" },
  {
    file: "plan/03-phase-2-multi-source-dedup.md",
    prefix: "P2",
    heading: "### Phase 2",
  },
  {
    file: "plan/04-phase-3-llm-summaries.md",
    prefix: "P3",
    heading: "### Phase 3",
  },
  {
    file: "plan/07-phase-4-trend-report.md",
    prefix: "P4",
    heading: "### Phase 4",
  },
  {
    file: "plan/08-phase-5-related-papers.md",
    prefix: "P5",
    heading: "### Phase 5",
  },
];

const INDEX = "plan/00-task-index.md";
const HEADER_ROW = "| Task | Title | Depends on | Est. | Gate |";

/** The four fields §4's table is built from, plus the title. */
interface Card {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly dependsOn: string;
  readonly estimate: string;
  readonly gated: boolean;
}

/**
 * The widest title a row carries before it is shortened.
 *
 * Not a layout rule — the tables are read as text as often as rendered — but a
 * plain ceiling so one 200-character title does not make the whole table
 * unreadable in a terminal.
 */
const TITLE_LIMIT = 62;

function shortenTitle(title: string): string {
  if (title.length <= TITLE_LIMIT) return title;
  const cut = title.slice(0, TITLE_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[,;:]$/, "")}…`;
}

function readCards(source: PhaseSource): readonly Card[] {
  const lines = readFileSync(source.file, "utf8").split("\n");
  const headingPattern = new RegExp(`^### (${source.prefix}-T\\d+) — (.+)$`);
  const cards: Card[] = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = headingPattern.exec(lines[i] ?? "");
    if (heading === null) continue;
    const id = heading[1] ?? "";
    const title = (heading[2] ?? "").replace(/\s+/g, " ").trim();

    let state: string | undefined;
    let dependsOn: string | undefined;
    let estimate: string | undefined;
    let gate: string | undefined;

    // The field table sits between the heading and the Goal paragraph. Reading
    // past Goal would pick up a quoted field from a correction note.
    for (let j = i; j < lines.length; j++) {
      const line = lines[j] ?? "";
      if (line.startsWith("**Goal.**")) break;
      state ??= /^\| \*\*State\*\* \| `([A-Z]+)`/.exec(line)?.[1];
      dependsOn ??= /^\| \*\*Depends on\*\* \| (.*) \|$/
        .exec(line)?.[1]
        ?.trim();
      estimate ??= /^\| \*\*Estimate\*\* \| ([\d.]+) d\b/.exec(line)?.[1];
      gate ??= /^\| \*\*Human gate\*\* \| (.*) \|$/.exec(line)?.[1]?.trim();
    }

    if (
      state === undefined ||
      dependsOn === undefined ||
      estimate === undefined ||
      gate === undefined
    ) {
      throw new Error(
        `${id}: could not read all four table fields from ${source.file} ` +
          `(state=${String(state)}, dependsOn=${String(dependsOn)}, ` +
          `estimate=${String(estimate)}, gate=${String(gate)})`,
      );
    }

    cards.push({
      id,
      title,
      done: state === "DONE",
      dependsOn: dependsOn === "none" ? "—" : dependsOn,
      estimate,
      gated: gate.startsWith("**Yes**"),
    });
  }

  if (cards.length === 0) {
    throw new Error(
      `${source.file}: no cards parsed — refusing to empty a table`,
    );
  }
  return cards;
}

function rowFor(card: Card): string {
  const tick = card.done ? "✅ " : "";
  const gate = card.gated ? "🔒" : "";
  return `| ${tick}\`${card.id}\` | ${shortenTitle(card.title)} | ${card.dependsOn} | ${card.estimate} d | ${gate} |`;
}

/** Replace one phase's rows in place, keeping everything around them. */
function rewriteTable(
  lines: string[],
  source: PhaseSource,
  cards: readonly Card[],
): number {
  const start = lines.indexOf(source.heading);
  if (start < 0) throw new Error(`${source.heading} not found in ${INDEX}`);

  let header = -1;
  for (let i = start; i < start + 8 && i < lines.length; i++) {
    if (lines[i] === HEADER_ROW) {
      header = i;
      break;
    }
  }
  if (header < 0) {
    throw new Error(`${source.heading}: table header row not found`);
  }

  const rowPattern = new RegExp(`\`${source.prefix}-T\\d+\``);
  let last = header + 1;
  for (let i = header + 2; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.startsWith("|")) break;
    if (rowPattern.test(line)) last = i;
  }

  const before = last - header - 1;
  lines.splice(header + 2, last - (header + 1), ...cards.map(rowFor));
  return before;
}

function main(): void {
  const lines = readFileSync(INDEX, "utf8").split("\n");
  const all: Card[] = [];

  for (const source of PHASES) {
    const cards = readCards(source);
    const before = rewriteTable(lines, source, cards);
    all.push(...cards);
    const done = cards.filter((c) => c.done).length;
    process.stdout.write(
      `  ${source.prefix}: ${String(before)} row(s) -> ${String(cards.length)} ` +
        `(${String(done)} DONE)\n`,
    );
  }

  const total = all.length;
  const done = all.filter((c) => c.done).length;
  const countOf = (prefix: string): { done: number; all: number } => {
    const cards = all.filter((c) => c.id.startsWith(`${prefix}-`));
    return { done: cards.filter((c) => c.done).length, all: cards.length };
  };

  /**
   * The size of the original decompositions: Phases 0–3's 98, from `docs/11`
   * §1's own account, plus Phase 4's 25, the card count `plan/07` was drafted
   * and reviewed with on 2026-10-25 (`plan/reports/phase4-review.md`), plus
   * Phase 5's 30, the count `plan/08` was drafted and reviewed with on
   * 2026-11-01 (`plan/reports/phase5-review.md`). `P5-T31`, added the same day
   * when the owner's decision (item 323(c)) was applied, counts as growth. Every
   * card beyond these exists because running the code (or deciding on it) found
   * work no reading of the corpus had, which is the growth figure the header
   * states. A later phase's decomposition adds its own count here, or the
   * header would call a whole new phase "growth".
   */
  const DECOMPOSED = 98 + 25 + 30;

  // The header's figures, each rewritten in place so the prose around them
  // stays. Every replacement is checked, because a pattern that silently stops
  // matching is how these numbers went stale in the first place.
  const headerIndex = lines.findIndex((l) =>
    l.startsWith("> **Last updated:**"),
  );
  if (headerIndex < 0)
    throw new Error("the header's Last updated line is missing");

  const p0 = countOf("P0");
  const p1 = countOf("P1");
  const p2 = countOf("P2");
  const p3 = countOf("P3");
  const p4 = countOf("P4");
  const p5 = countOf("P5");
  // The local calendar date. `toISOString()` is UTC, which stamped the
  // previous day on a run before 09:00 in Korea (measured 2026-10-26).
  const now = new Date();
  const today = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  const edits: readonly (readonly [RegExp, string])[] = [
    [
      /> \*\*Last updated:\*\* \d{4}-\d{2}-\d{2}/,
      `> **Last updated:** ${today}`,
    ],
    [
      /\*\*\d+ tasks: \d+ `DONE`, \d+ `TODO`\.\*\*/,
      `**${String(total)} tasks: ${String(done)} \`DONE\`, ${String(total - done)} \`TODO\`.**`,
    ],
    [
      /Phase 0 is \*\*\d+ of \d+\*\*/,
      `Phase 0 is **${String(p0.done)} of ${String(p0.all)}**`,
    ],
    [
      /Phase 1 is \*\*\d+ of \d+ `DONE`\*\*/,
      `Phase 1 is **${String(p1.done)} of ${String(p1.all)} \`DONE\`**`,
    ],
    [
      /Phase 2 \*\*\d+ of \d+\*\*/,
      `Phase 2 **${String(p2.done)} of ${String(p2.all)}**`,
    ],
    [
      /Phase 3 \*\*\d+ of \d+\*\*/,
      `Phase 3 **${String(p3.done)} of ${String(p3.all)}**`,
    ],
    [
      /Phase 4 \*\*\d+ of \d+\*\*/,
      `Phase 4 **${String(p4.done)} of ${String(p4.all)}**`,
    ],
    [
      /Phase 5 \*\*\d+ of \d+\*\*/,
      `Phase 5 **${String(p5.done)} of ${String(p5.all)}**`,
    ],
    [
      // `$1` keeps the parenthetical account of where the count comes from.
      /from the \d+ cards its decompositions produced \(([^)]*)\) to \d+, so \d+ of them/,
      `from the ${String(DECOMPOSED)} cards its decompositions produced ($1) ` +
        `to ${String(total)}, so ${String(total - DECOMPOSED)} of them`,
    ],
  ];

  let header = lines[headerIndex] ?? "";
  for (const [pattern, replacement] of edits) {
    const next = header.replace(pattern, replacement);
    if (next === header && !pattern.test(header)) {
      throw new Error(
        `the header no longer matches ${String(pattern)} — read the line and fix ` +
          "the pattern rather than leaving a stale number behind",
      );
    }
    header = next;
  }
  lines[headerIndex] = header;

  writeFileSync(INDEX, lines.join("\n"));
  process.stdout.write(
    `  header: ${String(total)} tasks, ${String(done)} DONE, ` +
      `${String(total - done)} TODO\n${INDEX} derived from the cards\n`,
  );
}

main();

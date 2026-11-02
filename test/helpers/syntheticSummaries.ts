/**
 * Deterministic synthetic stored summaries for scale tests.
 *
 * **Scope.** `plan/07` `P4-T22` step 1: a seeded collection of papers, each
 * with one `StoredSummary` (`docs/07` §5.2, `src/model/summary.ts`) whose
 * `content` serializes to 900–1 600 tokens by `estTokens` with no model id
 * (`docs/06` §8.1: "Serialized in full, each is 900–1 600 tokens").
 * Callers: `test/unit/pipeline/trendScale.test.ts` (`P4-T22`) and, when it is
 * built, `P4-T24`'s determinism script tests.
 *
 * **Deterministic.** Everything is drawn from {@link seededRandom} (mulberry32)
 * on the given seed, so the same `count` and `seed` give byte-identical
 * summaries on every machine. Nothing here reads the clock, the environment,
 * the network or a key; every word is synthetic text written here.
 *
 * **Themes.** Each paper belongs to one of {@link SYNTHETIC_TOPICS}, which
 * fills its `researchTheme`, keywords, methods and question, so a scripted
 * clustering can group papers by their digest's `Theme(first-pass):` line.
 * Every `orphanEvery`-th paper has `researchTheme: null`, so its digest has no
 * theme line (a scripted clusterer can leave it unplaced, which makes the
 * client-generated `Other` theme of `docs/12` §8 rule (3)).
 */

import { sha256Hex } from "../../src/core/cache/keys";
import { estTokens } from "../../src/llm/shared/tokenEstimate";
import {
  PAPER_SUMMARY_SCHEMA_VERSION,
  type PaperSummary,
  type StoredSummary,
  type StudyDesignLabel,
} from "../../src/model/summary";

/** The serialized size every synthetic summary falls in (`docs/06` §8.1). */
export const SYNTHETIC_SUMMARY_MIN_TOKENS = 900;
export const SYNTHETIC_SUMMARY_MAX_TOKENS = 1_600;

/** One synthetic research topic: its theme name and its own vocabulary. */
export interface SyntheticTopic {
  readonly theme: string;
  readonly subject: string;
  readonly keywords: readonly string[];
  readonly methods: readonly string[];
  readonly outcomes: readonly string[];
}

/** Ten topics, so a 400-paper run has 10 themes (`docs/06` §9.2: 7–12). */
export const SYNTHETIC_TOPICS: readonly SyntheticTopic[] = Object.freeze([
  {
    theme: "Soil Carbon Sequestration",
    subject: "soil organic carbon under cover cropping",
    keywords: ["soil carbon", "cover crops", "tillage", "agronomy"],
    methods: ["paired field plots", "dry combustion assay", "mixed models"],
    outcomes: ["topsoil carbon stock", "aggregate stability"],
  },
  {
    theme: "Coastal Sediment Transport",
    subject: "sediment flux along sandy coastlines",
    keywords: ["sediment", "longshore drift", "beach profile", "waves"],
    methods: ["drone photogrammetry", "tracer pebbles", "process model"],
    outcomes: ["shoreline retreat", "bar migration rate"],
  },
  {
    theme: "Urban Heat Island Mitigation",
    subject: "street tree canopy and surface temperature",
    keywords: ["urban heat", "tree canopy", "land surface", "cooling"],
    methods: ["thermal remote sensing", "street transects", "regression"],
    outcomes: ["surface temperature", "night cooling rate"],
  },
  {
    theme: "Groundwater Nitrate Pollution",
    subject: "nitrate leaching from fertilised fields",
    keywords: ["nitrate", "groundwater", "fertiliser", "leaching"],
    methods: ["monitoring wells", "isotope tracing", "transport model"],
    outcomes: ["nitrate concentration", "leaching load"],
  },
  {
    theme: "Pollinator Habitat Restoration",
    subject: "wildflower strips and wild bee abundance",
    keywords: ["pollinators", "wild bees", "flower strips", "habitat"],
    methods: ["pan traps", "transect walks", "occupancy models"],
    outcomes: ["bee abundance", "species richness"],
  },
  {
    theme: "Wetland Methane Emissions",
    subject: "methane flux from restored peat wetlands",
    keywords: ["methane", "peatland", "rewetting", "flux"],
    methods: ["static chambers", "eddy covariance", "flux partitioning"],
    outcomes: ["methane flux", "water table depth"],
  },
  {
    theme: "Microplastic River Loads",
    subject: "microplastic particles carried by rivers",
    keywords: ["microplastics", "rivers", "particles", "pollution"],
    methods: ["net sampling", "infrared spectroscopy", "load estimation"],
    outcomes: ["particle concentration", "annual load"],
  },
  {
    theme: "Forest Drought Mortality",
    subject: "tree mortality after repeated drought years",
    keywords: ["drought", "tree mortality", "forests", "hydraulics"],
    methods: ["inventory plots", "sap flow sensors", "survival analysis"],
    outcomes: ["mortality rate", "crown dieback"],
  },
  {
    theme: "Air Quality Low Cost Sensors",
    subject: "calibration of low cost particulate sensors",
    keywords: ["air quality", "sensors", "particulate matter", "calibration"],
    methods: [
      "colocation campaigns",
      "random forest calibration",
      "drift tests",
    ],
    outcomes: ["measurement error", "sensor drift"],
  },
  {
    theme: "Glacier Mass Balance",
    subject: "mass balance of small mountain glaciers",
    keywords: ["glaciers", "mass balance", "melt", "snow"],
    methods: ["stake networks", "geodetic differencing", "degree day model"],
    outcomes: ["annual mass balance", "equilibrium line altitude"],
  },
]);

const DESIGNS: readonly StudyDesignLabel[] = [
  "prospective_cohort",
  "retrospective_cohort",
  "cross_sectional",
  "non_randomized_trial",
  "computational_simulation",
  "in_vivo_animal",
];

const FILLER: readonly string[] = [
  "the sampling covered several seasons and sites",
  "the analysis adjusted for site and year as random effects",
  "measurements were repeated by a second team at a subset of sites",
  "the authors report sensitivity checks with a stricter outlier rule",
  "data were collected under a published field protocol",
  "the study compares its estimates with two earlier regional surveys",
  "uncertainty is reported as a range across bootstrap resamples",
  "the effect was weaker at the wettest sites in the network",
  "results were stable when the first year of data was dropped",
  "the authors note a gap in winter observations at two sites",
  "a pilot season was used to set the sampling interval",
  "the comparison sites were matched on slope and soil class",
];

const DIRECTIONS = ["positive", "negative", "mixed", "null_result"] as const;
const STRENGTHS = ["strong", "moderate", "weak"] as const;

/**
 * mulberry32: a small, fast, seeded generator. Returns numbers in [0, 1).
 *
 * @param seed - any 32-bit integer
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A synthetic Zotero item key: `S` and seven digits (`^[A-Z0-9]{8}$`). */
export function syntheticKey(i: number): string {
  return `S${String(i).padStart(7, "0")}`;
}

/** One synthetic paper: its identity, its Zotero metadata and its summary. */
export interface SyntheticPaper {
  /** 1-based position in the collection. */
  readonly index: number;
  readonly itemKey: string;
  readonly workKey: string;
  readonly title: string;
  readonly year: number;
  readonly doi: string;
  /** The topic, or `undefined` for an orphan (no `researchTheme`). */
  readonly topic: SyntheticTopic | undefined;
  /** `estTokens(JSON.stringify(summary.content))`, no model id. */
  readonly summaryTokens: number;
  readonly summary: StoredSummary;
}

/** Options for {@link syntheticPapers}. */
export interface SyntheticOptions {
  readonly count: number;
  readonly seed: number;
  /** Every n-th paper is an orphan with no theme; 0 for none. Default 50. */
  readonly orphanEvery?: number;
  /** `generatedAtEpochMs` of every row. Default 1 760 000 000 000. */
  readonly generatedAtEpochMs?: number;
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function tokensOf(content: PaperSummary): number {
  return estTokens(JSON.stringify(content));
}

/** A sentence about `topic`, varied by the generator. */
function sentence(random: () => number, topic: SyntheticTopic): string {
  const outcome = pick(random, topic.outcomes);
  const filler = pick(random, FILLER);
  const percent = 5 + Math.floor(random() * 40);
  return `The ${outcome} changed by ${String(percent)} percent where ${topic.subject} was studied, and ${filler}.`;
}

function contentFor(
  random: () => number,
  itemKey: string,
  topic: SyntheticTopic | undefined,
  target: number,
): PaperSummary {
  const own = topic ?? (SYNTHETIC_TOPICS[0] as SyntheticTopic);
  const n = 40 + Math.floor(random() * 900);
  const content: PaperSummary = {
    schemaVersion: PAPER_SUMMARY_SCHEMA_VERSION,
    itemKey,
    sourceTier: random() < 0.3 ? "fulltext_pdf" : "abstract",
    confidence: random() < 0.8 ? "high" : "medium",
    researchQuestion: `How does ${own.subject} affect the ${pick(random, own.outcomes)} across the sites studied?`,
    studyDesign: { label: pick(random, DESIGNS), detail: null },
    population: {
      kind: "not_applicable",
      description: `${String(n)} sites studied for ${own.subject}`,
      size: String(n),
    },
    methods: [...own.methods],
    keyFindings: [],
    effectSizes: [
      {
        metric: pick(random, own.outcomes),
        value: `${String(5 + Math.floor(random() * 40))} percent`,
        comparison: "control sites",
        unit: null,
      },
    ],
    limitations: [`Only ${String(n)} sites were sampled.`],
    novelty: `First multi site study of ${own.subject} at this scale.`,
    keywords: [...own.keywords],
    researchTheme: topic === undefined ? null : topic.theme,
    citationWorthiness: {
      score: 20 + Math.floor(random() * 70),
      reason: `A careful study of ${own.subject}.`,
    },
  };
  // Grow round robin until the target; never past the maximum.
  for (let step = 0; tokensOf(content) < target; step += 1) {
    const text = sentence(random, own);
    const before = JSON.stringify(content);
    switch (step % 3) {
      case 0:
        content.keyFindings.push({
          statement: text,
          direction: pick(random, DIRECTIONS),
          evidenceStrength: pick(random, STRENGTHS),
          verbatimSupport: text,
        });
        break;
      case 1:
        content.limitations.push(text);
        break;
      default:
        content.methods.push(`${pick(random, own.methods)}: ${text}`);
    }
    if (tokensOf(content) > SYNTHETIC_SUMMARY_MAX_TOKENS) {
      Object.assign(content, JSON.parse(before) as PaperSummary);
      break;
    }
  }
  return content;
}

/**
 * `count` papers with stored summaries, deterministic in `seed`.
 *
 * @throws RangeError when `count` is not a positive whole number below 10⁷,
 *   or when a summary falls outside 900–1 600 tokens (a defect here)
 */
export function syntheticPapers(options: SyntheticOptions): SyntheticPaper[] {
  const { count, seed } = options;
  if (!Number.isInteger(count) || count < 1 || count >= 10_000_000) {
    throw new RangeError("syntheticPapers needs a count from 1 to 9 999 999");
  }
  const orphanEvery = options.orphanEvery ?? 50;
  const at = options.generatedAtEpochMs ?? 1_760_000_000_000;
  const random = seededRandom(seed);
  const papers: SyntheticPaper[] = [];
  for (let index = 1; index <= count; index += 1) {
    const itemKey = syntheticKey(index);
    const orphan = orphanEvery > 0 && index % orphanEvery === 0;
    const topic = orphan
      ? undefined
      : (SYNTHETIC_TOPICS[
          Math.floor(random() * SYNTHETIC_TOPICS.length)
        ] as SyntheticTopic);
    const target =
      SYNTHETIC_SUMMARY_MIN_TOKENS +
      Math.floor(
        random() *
          (SYNTHETIC_SUMMARY_MAX_TOKENS - SYNTHETIC_SUMMARY_MIN_TOKENS - 60),
      );
    const content = contentFor(random, itemKey, topic, target);
    const summaryTokens = tokensOf(content);
    if (
      summaryTokens < SYNTHETIC_SUMMARY_MIN_TOKENS ||
      summaryTokens > SYNTHETIC_SUMMARY_MAX_TOKENS
    ) {
      throw new RangeError(
        `synthetic summary ${itemKey} is ${String(summaryTokens)} tokens`,
      );
    }
    const doi = `10.5555/synthetic.${itemKey.toLowerCase()}`;
    const workKey = `doi:${doi}`;
    const promptVersion = "1.0.0";
    const modelId = "synthetic-summary-model";
    const json = JSON.stringify(content);
    const summary: StoredSummary = {
      id: `${workKey}:${promptVersion}:${modelId}`,
      workKey,
      zoteroItemKey: itemKey,
      content,
      inputScope: { kind: "abstract" },
      promptId: "PAPER_SUMMARY_ABSTRACT",
      promptVersion,
      providerId: "openrouter",
      modelId,
      temperature: 0,
      usage: undefined,
      generatedAtEpochMs: at,
      sourceItemVersion: "2026-10-01 00:00:00",
      contentHash: sha256Hex(json),
      truncated: false,
      groundingScore: 1,
      warnings: [],
      redaction: {
        partlyRedacted: false,
        redactedStrings: 0,
        droppedFields: 0,
      },
    };
    papers.push({
      index,
      itemKey,
      workKey,
      title: `${topic?.theme ?? "Field Notes"} study ${String(index)}`,
      year: 2015 + Math.floor(random() * 10),
      doi,
      topic,
      summaryTokens,
      summary,
    });
  }
  return papers;
}

/**
 * `P3-T40`: the held-out IMRaD fixture set (`test/fixtures/imrad-heldout/`,
 * `plan/00` §6 item 374).
 *
 * Pins four things:
 *
 * 1. **The manifest** — the papers of item 374(a) in that order, less HI1
 *    (item 374(d): its PDF holds another paper), none of the spares, every
 *    licence redistributable, every text matching its sidecar's SHA-256 byte
 *    for byte.
 * 2. **Kept apart from the first set** — no held-out paper shares a DOI,
 *    another identifier or a title with `test/fixtures/imrad/`.
 * 3. **The candidate lines and the labels** — `candidate-headings.json` is
 *    the plain line-shape rule over the committed text, and `labels/` holds
 *    only files that validate (none until the owner labels in chat).
 * 4. **The seal** — `scripts/measure-imrad.ts` refuses the held-out set
 *    without its final-measurement flag, before reading anything and before
 *    any detector runs. Tested with a detector double and an empty set, so
 *    no detector ever runs on the held-out text here.
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCandidatesFile,
  CANDIDATES_FILE,
  FIXTURE_SETS,
  fixtureSetFromArgs,
  IMRAD_DIR,
  IMRAD_HELDOUT_DIR,
  LABELS_DIR,
  readManifest,
  REDISTRIBUTABLE_LICENCES,
  validateFixtureSet,
  validateLabels,
  validateManifest,
  type CandidatesFile,
} from "../../../scripts/build-imrad-fixtures";
import {
  FINAL_HELDOUT_FLAG,
  main,
  measureRequest,
  SEALED_EXIT,
  type Detector,
} from "../../../scripts/measure-imrad";

/**
 * The held-out set, `plan/00` §6 item 374(a), less `HI1`: the file `HI1.pdf`
 * holds HO2's paper, so HI1 waits until its PDF is the right one (item
 * 374(d)). Add it back here when it is.
 */
const PENDING = ["HI1"];
const HELDOUT_IDS = [
  "HE1",
  "HE2",
  "HS1",
  "HS2",
  "HW1",
  "HW2",
  "HO1",
  "HO3",
  "HP1",
  "HP2",
  "HN1",
  "HN2",
  "HI2",
  "HA1",
  "HA2",
  "HB1",
  "HB2",
  "HX1",
  "HX2",
];

/** In the PDF folder or the candidate list, but not in the set. */
const NOT_IN_SET = ["HE3", "HI3", "HX3", "HO2"];

function normalTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The manifest
// ---------------------------------------------------------------------------

describe("held-out imrad manifest", () => {
  it("lists the papers of item 374(a) in order, less the pending HI1, and no spare", async () => {
    const raw: unknown = JSON.parse(
      await readFile(join(IMRAD_HELDOUT_DIR, "manifest.json"), "utf8"),
    );
    expect(validateManifest(raw)).toEqual([]);
    const { papers } = await readManifest(IMRAD_HELDOUT_DIR);
    expect(papers.map((p) => p.id)).toEqual(HELDOUT_IDS);
    for (const id of [...NOT_IN_SET, ...PENDING]) {
      expect(papers.map((p) => p.id)).not.toContain(id);
    }
  });

  it("gives every paper a redistributable licence, the web lists as not checked, and preprints only from the preprint servers", async () => {
    const { papers } = await readManifest(IMRAD_HELDOUT_DIR);
    for (const paper of papers) {
      expect(REDISTRIBUTABLE_LICENCES, paper.id).toContain(paper.licence);
      expect(paper.licenceEvidence, paper.id).not.toBe("");
      expect(paper.layout.webHeadings, paper.id).toBe("not checked");
      expect(paper.preprint, paper.id).toBe(
        ["arxiv", "biorxiv"].includes(paper.publisher),
      );
    }
  });

  it("has, for every paper, its text and a sidecar whose SHA-256 matches it byte for byte", async () => {
    expect(await validateFixtureSet(IMRAD_HELDOUT_DIR)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Kept apart from the first set
// ---------------------------------------------------------------------------

describe("held-out set against the first set", () => {
  it("shares no DOI, other identifier or title with test/fixtures/imrad/", async () => {
    const first = await readManifest(IMRAD_DIR);
    const heldout = await readManifest(IMRAD_HELDOUT_DIR);
    const firstKeys = new Set(
      first.papers.flatMap((p) => [
        ...(p.doi === null ? [] : [`doi:${p.doi.toLowerCase()}`]),
        ...(p.otherId === null ? [] : [`id:${p.otherId.toLowerCase()}`]),
        `title:${normalTitle(p.title)}`,
      ]),
    );
    for (const p of heldout.papers) {
      const keys = [
        ...(p.doi === null ? [] : [`doi:${p.doi.toLowerCase()}`]),
        ...(p.otherId === null ? [] : [`id:${p.otherId.toLowerCase()}`]),
        `title:${normalTitle(p.title)}`,
      ];
      for (const key of keys)
        expect(firstKeys.has(key), `${p.id} ${key}`).toBe(false);
    }
    expect(
      heldout.papers.some((p) => first.papers.some((q) => q.id === p.id)),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Candidate lines and labels
// ---------------------------------------------------------------------------

describe("held-out candidate lines and labels", () => {
  it("matches the committed candidate-headings.json, rebuilt from the committed text with --set heldout", async () => {
    const committed = JSON.parse(
      await readFile(join(IMRAD_HELDOUT_DIR, CANDIDATES_FILE), "utf8"),
    ) as CandidatesFile;
    const manifest = await readManifest(IMRAD_HELDOUT_DIR);
    const texts = await Promise.all(
      manifest.papers.map(async (p) => ({
        id: p.id,
        text: await readFile(join(IMRAD_HELDOUT_DIR, p.textFile), "utf8"),
      })),
    );
    expect(committed).toEqual(buildCandidatesFile(texts, FIXTURE_SETS.heldout));
    expect(committed.papers).toHaveLength(HELDOUT_IDS.length);
    expect(committed.generatedBy).toBe(
      "npx tsx scripts/build-imrad-fixtures.ts candidates --set heldout",
    );
  });

  it("has a labels directory with no file yet, or only files that validate against their text", async () => {
    const dir = join(IMRAD_HELDOUT_DIR, LABELS_DIR);
    expect(existsSync(dir)).toBe(true);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
    const manifest = await readManifest(IMRAD_HELDOUT_DIR);
    for (const name of names) {
      const id = name.slice(0, -".json".length);
      expect(manifest.papers.map((p) => p.id)).toContain(id);
      const text = await readFile(
        join(IMRAD_HELDOUT_DIR, "text", `${id}.txt`),
        "utf8",
      );
      const value: unknown = JSON.parse(
        await readFile(join(dir, name), "utf8"),
      );
      expect(validateLabels(value, id, text), name).toEqual([]);
    }
    const labelled = new Set(names.map((n) => n.slice(0, -".json".length)));
    for (const paper of manifest.papers) {
      expect(paper.hasImradStructure === null, paper.id).toBe(
        !labelled.has(paper.id),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The set selector and the seal
// ---------------------------------------------------------------------------

describe("the set selector (build-imrad-fixtures.ts --set)", () => {
  it("defaults to the first set, whose candidate file names no --set", () => {
    expect(fixtureSetFromArgs([])).toBe(FIXTURE_SETS.first);
    expect(fixtureSetFromArgs(["--set", "first"])).toBe(FIXTURE_SETS.first);
    expect(fixtureSetFromArgs(["x", "--set", "heldout"])).toBe(
      FIXTURE_SETS.heldout,
    );
    expect(fixtureSetFromArgs(["--set", "other"])).toMatch(/--set needs/u);
    expect(fixtureSetFromArgs(["--set"])).toMatch(/--set needs/u);
    expect(buildCandidatesFile([]).generatedBy).toBe(
      "npx tsx scripts/build-imrad-fixtures.ts candidates",
    );
    expect(FIXTURE_SETS.first.dir).toBe(IMRAD_DIR);
    expect(FIXTURE_SETS.heldout.dir).toBe(IMRAD_HELDOUT_DIR);
  });
});

describe("the seal (measure-imrad.ts refuses the held-out set)", () => {
  /** A detector double that records every call and must never be called. */
  function spyDetector(): { detector: Detector; calls: string[] } {
    const calls: string[] = [];
    const detector: Detector = (text) => {
      calls.push(text.slice(0, 20));
      return { sectionAware: false, recognized: 0, sections: [] };
    };
    return { detector, calls };
  }

  it("refuses --set heldout without the flag, and the flag without --set heldout", () => {
    expect(measureRequest(["--set", "heldout"])).toMatchObject({
      kind: "refuse",
      code: SEALED_EXIT,
    });
    expect(measureRequest([FINAL_HELDOUT_FLAG])).toMatchObject({
      kind: "refuse",
      code: 2,
    });
    expect(measureRequest(["--set", "heldout", "--extra"])).toMatchObject({
      kind: "refuse",
      code: 2,
    });
    expect(measureRequest([])).toEqual({
      kind: "measure",
      set: FIXTURE_SETS.first,
      final: false,
    });
    expect(measureRequest(["--set", "heldout", FINAL_HELDOUT_FLAG])).toEqual({
      kind: "measure",
      set: FIXTURE_SETS.heldout,
      final: true,
    });
  });

  it("exits 3 before reading the set or running a detector", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { detector, calls } = spyDetector();
    const dirFor = vi.fn(() => {
      throw new Error("the held-out set was read");
    });
    expect(await main(["--set", "heldout"], { detector, dirFor })).toBe(
      SEALED_EXIT,
    );
    expect(calls).toEqual([]);
    expect(dirFor).not.toHaveBeenCalled();
  });

  it("under the flag, refuses an empty set as nothing to measure, and runs no detector", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const empty = await mkdtemp(join(tmpdir(), "rh-imrad-heldout-empty-"));
    try {
      await writeFile(
        join(empty, "manifest.json"),
        JSON.stringify({
          schema: "imrad-manifest-v1",
          description: "empty",
          papers: [],
        }),
        "utf8",
      );
      await mkdir(join(empty, "text"));
      await mkdir(join(empty, "labels"));
      const { detector, calls } = spyDetector();
      expect(
        await main(["--set", "heldout", FINAL_HELDOUT_FLAG], {
          detector,
          dirFor: () => empty,
        }),
      ).toBe(2);
      expect(calls).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

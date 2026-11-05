/**
 * `P5-T26` and `P5-T27`: the recommend mode's view model, from hand-built pipeline outputs.
 *
 * Plain Node, no network, no key and no Zotero. The pipeline is a stand-in, so a pass
 * here says what the window is told about a result and what the pipeline is handed,
 * and nothing about any service. The document's half, including that the profile
 * reaches the page as plain text, is `test/unit/ui/searchDialog.test.ts`'s "P5-T26"
 * block, and its "P5-T27: the results" block has the table.
 */

import { describe, expect, it, vi } from "vitest";

import type { CancellationToken } from "../../../src/core/jobQueue/cancellation";
import type { ProgressSnapshot } from "../../../src/core/jobQueue/progress";
import { StorageError } from "../../../src/core/errors";
import type { Logger } from "../../../src/core/logger";
import type { CollectionProfile } from "../../../src/model/profile";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../../../src/pipeline/searchImport/types";
import { RECOMMEND_WATCH_AUTHORS } from "../../../src/pipeline/recommend/generators";
import type { ProfileConfirmRequest } from "../../../src/pipeline/recommend/profileCall";
import { validateRecommendInput } from "../../../src/pipeline/recommend/recommendPipeline";
import type { RecommendationRow } from "../../../src/pipeline/recommend/score";
import { MAX_NEGATIVES } from "../../../src/pipeline/recommend/seeds";
import type {
  RecommendBudgetQuestion,
  RecommendEditedProfileInput,
  RecommendInput,
  RecommendOutput,
  RecommendPipeline,
  RecommendSurface,
} from "../../../src/pipeline/recommend/types";
import { L10N_MENU_COLLECTION_RECOMMEND } from "../../../src/i18n/keys";
import { PREFS } from "../../../src/prefs/schema";
import {
  collectionMenuOptions,
  type SearchMenuCommands,
} from "../../../src/ui/menus/registerMenus";
import type { CostDialogOutcome } from "../../../src/ui/dialogs/costConfirmDialog";
import {
  cleanTerm,
  confirmProfileCall,
  createRecommendViewModel,
  editsWithAdded,
  explorationOf,
  groupedRows,
  reasonRefs,
  editsWithRemoved,
  editsWithRestored,
  initialRecommendViewState,
  profileView,
  recommendFailureView,
  RECOMMEND_DEFAULT_EXPLORATION,
  RECOMMEND_DEFAULT_SLIDER,
  RECOMMEND_TERMS_SHOWN,
  visibleTerms,
  type RecommendConfirmDeps,
  type RecommendImportPort,
  type RecommendViewState,
  type RecommendWindowView,
} from "../../../src/ui/viewModels/recommendViewModel";
import type { CollectionDescriptor } from "../../../src/ui/viewModels/searchImportViewModel";
import { collectionProfileId } from "../../../src/zotero/db";

const LIBRARY_ID = 1;
const COLLECTION_KEY = "ABCD2345";
const COLLECTION_ID = 77;
const NO_EDITS = { removedTerms: [], addedTerms: [] };

/** Heavier first: `term-0` weighs most. */
function weights(count: number): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, at) => [`term-${String(at)}`, 100 - at]),
  );
}

function profileOf(extra: Partial<CollectionProfile> = {}): CollectionProfile {
  return {
    id: collectionProfileId(LIBRARY_ID, COLLECTION_KEY),
    libraryID: LIBRARY_ID,
    collectionKey: COLLECTION_KEY,
    collectionName: "mRNA LNP",
    centroids: [],
    termWeights: weights(3),
    topAuthors: [
      { name: "Cullis", count: 9 },
      { name: "Anderson", count: 7 },
    ],
    topVenues: [{ name: "Nature", count: 4 }],
    suggestedQueries: [],
    origin: "heuristic",
    ...extra,
  } as unknown as CollectionProfile;
}

function profileEnding(
  profile: CollectionProfile = profileOf(),
  extra: Record<string, unknown> = {},
): RecommendOutput {
  return {
    outcome: "succeeded",
    ending: "profile",
    stageReached: "ApplyingStoredEdits",
    profile,
    built: true,
    vectorsIncomplete: false,
    ...extra,
  } as unknown as RecommendOutput;
}

function rowOf(
  n: number,
  extra: Partial<RecommendationRow> = {},
): RecommendationRow {
  return {
    recommendation: {
      work: {
        workKey: `key-${String(n)}`,
        title: `Paper ${String(n)}`,
        authors: [{ family: `Author${String(n)}` }],
        publishedDate: { year: 2024, iso: "2024" },
      },
      profileId: collectionProfileId(LIBRARY_ID, COLLECTION_KEY),
      reasons: [{ id: "similarity" }],
      signals: { similarity: 0.5 },
      similaritySpace: "specter_v2",
    },
    records: [{ sourceId: "europepmc", work: { title: `Paper ${String(n)}` } }],
    inLibrary: false,
    dismissed: false,
    preprint: false,
    checkedByDefault: true,
    ...extra,
  } as unknown as RecommendationRow;
}

function rowsEnding(
  rows: readonly RecommendationRow[],
  extra: Record<string, unknown> = {},
): RecommendOutput {
  return {
    outcome: "succeeded",
    ending: "rows",
    stageReached: "Diversifying",
    profile: profileOf(),
    profileRebuilt: false,
    rows,
    statuses: [],
    keyNotice: false,
    similarity: { space: "specter_v2" },
    vectorsIncomplete: false,
    ...extra,
  } as unknown as RecommendOutput;
}

function failedEnding(extra: Record<string, unknown> = {}): RecommendOutput {
  return {
    outcome: "failed",
    stageReached: "BuildingStats",
    statuses: [],
    error: {
      code: "UNKNOWN",
      messageKey: "rh-error-unknown",
      detail: "a detail",
      retryable: true,
    },
    ...extra,
  } as unknown as RecommendOutput;
}

const CANCELLED = {
  outcome: "cancelled",
  stageReached: "BuildingStats",
} as unknown as RecommendOutput;

/** An import that wrote everything it was given. */
function wroteOutput(extra: Record<string, unknown> = {}): SearchImportOutput {
  return {
    outcome: "succeeded",
    write: {
      created: 2,
      linkedExisting: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      abstractCoveragePercent: 100,
    },
    ...extra,
  } as unknown as SearchImportOutput;
}

/** What a dialog skipped for a routine run is asked with. */
function confirmRequest(
  extra: Partial<ProfileConfirmRequest> = {},
): ProfileConfirmRequest {
  return {
    estimate: {
      selected: { calls: 1, costUsd: 0.5, items: [], counts: {} },
    },
    disclosure: { providerId: "openrouter" },
    confirmation: { ask: true, reasons: [] },
    ceilingSelected: undefined,
    collection: { libraryID: LIBRARY_ID, collectionKey: COLLECTION_KEY },
    session: { costUsd: 0 },
    ...extra,
  } as unknown as ProfileConfirmRequest;
}

function confirmDeps(
  outcome: () => Promise<CostDialogOutcome> = () =>
    Promise.resolve({
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: true,
    }),
) {
  const settle = vi.fn<RecommendConfirmDeps["settle"]>();
  const openDialog = vi.fn<RecommendConfirmDeps["openDialog"]>(outcome);
  const deps: RecommendConfirmDeps = {
    openDialog,
    settle,
    confirmAboveCents: () => 10,
    fullTextAutoMaxPapers: () => 5,
    providerName: () => Promise.resolve("OpenRouter"),
    locale: () => "en-US",
  };
  return { deps, settle, openDialog };
}

/** A pipeline, a job factory and a window, each recording what it was given. */
function world(
  answer: (
    input: RecommendInput,
    surface: RecommendSurface,
  ) => Promise<RecommendOutput> | RecommendOutput = (input) =>
    input.mode === "profile-only" ? profileEnding() : rowsEnding([rowOf(1)]),
  options: {
    readonly collection?: boolean;
    readonly confirm?: RecommendConfirmDeps;
    readonly askBudget?: (
      question: RecommendBudgetQuestion,
    ) => Promise<"resume" | "cancel">;
    readonly reject?: (profileId: string, workKey: string) => Promise<boolean>;
    readonly importOutput?: () => Promise<SearchImportOutput>;
    /** Read at each `collectionOf`: the collection went while the window stood. */
    readonly collectionGone?: () => boolean;
  } = {},
) {
  const inputs: RecommendInput[] = [];
  const tokens: CancellationToken[] = [];
  const openOptions: unknown[] = [];
  const done = vi.fn<(outcome: string, message?: string) => void>();
  const dispose = vi.fn();
  const unsubscribed = vi.fn();
  let listener: ((snapshot: ProgressSnapshot) => void) | undefined;
  const execute = vi.fn(
    async (
      input: RecommendInput,
      _ctx: unknown,
      surface: RecommendSurface,
    ): Promise<RecommendOutput> => {
      inputs.push(input);
      return answer(input, surface);
    },
  );
  const reject = vi.fn(options.reject ?? (() => Promise.resolve(true)));
  const importRun = vi.fn<
    (input: SearchImportInput, ctx: unknown) => Promise<SearchImportOutput>
  >(options.importOutput ?? (() => Promise.resolve(wroteOutput())));
  const pipeline = {
    id: "recommend",
    validate: validateRecommendInput,
    execute,
    reject,
    run: () => {
      throw new Error(
        "the window must not use run: it declines every question",
      );
    },
  } as unknown as RecommendPipeline;
  const openJob = vi.fn((given: { readonly token: CancellationToken }) => {
    openOptions.push(given);
    tokens.push(given.token);
    return Promise.resolve({
      context: {} as never,
      progress: {
        reporter: { done },
        events: {
          subscribe(next: (snapshot: ProgressSnapshot) => void) {
            listener = next;
            return unsubscribed;
          },
        },
      },
      dispose,
    });
  });
  const warn = vi.fn();
  const model = createRecommendViewModel({
    pipeline,
    jobs: { openJob },
    logger: { warn, info: vi.fn() } as unknown as Logger,
    keyRequestUrl: "https://example.org/key",
    maxPaperIdentifiers: 15,
    collectionOf: (id) =>
      options.collection === false ||
      id !== COLLECTION_ID ||
      options.collectionGone?.() === true
        ? undefined
        : {
            libraryID: LIBRARY_ID,
            collectionKey: COLLECTION_KEY,
            name: "mRNA LNP",
          },
    confirm: options.confirm ?? confirmDeps().deps,
    askBudget: options.askBudget ?? (() => Promise.resolve("cancel")),
    imports: {
      pipeline: {
        run: importRun,
      } as unknown as RecommendImportPort["pipeline"],
      listCollections: () => [
        { id: 9, name: "Elsewhere" } as CollectionDescriptor,
      ],
    },
  });
  const states: RecommendViewState[] = [];
  const view: RecommendWindowView = { render: (state) => states.push(state) };
  return {
    model,
    host: model.host,
    view,
    states,
    inputs,
    tokens,
    openOptions,
    openJob,
    execute,
    reject,
    importRun,
    done,
    dispose,
    unsubscribed,
    warn,
    emit: (snapshot: ProgressSnapshot) => listener?.(snapshot),
    last: () => model.state(),
    /** Connected and on the collection. */
    opened() {
      model.host.connect(view);
      model.host.open(COLLECTION_ID);
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("the term edits", () => {
  const profile = profileOf({ termWeights: { alpha: 3, beta: 2, gamma: 1 } });

  it("draws added terms first, then the heaviest, less the removed", () => {
    const chips = visibleTerms(profile, {
      removedTerms: ["beta"],
      addedTerms: ["delta"],
    });
    expect(chips.map(({ term, added }) => [term, added])).toStrictEqual([
      ["delta", true],
      ["alpha", false],
      ["gamma", false],
    ]);
  });

  it("draws at most the shown number of the profile's terms, heaviest first", () => {
    const chips = visibleTerms(
      profileOf({ termWeights: weights(RECOMMEND_TERMS_SHOWN + 5) }),
      NO_EDITS,
    );
    expect(chips).toHaveLength(RECOMMEND_TERMS_SHOWN);
    expect(chips[0]?.term).toBe("term-0");
  });

  it("does not draw an added term twice when the profile holds it too", () => {
    const chips = visibleTerms(profile, {
      removedTerms: [],
      addedTerms: ["ALPHA"],
    });
    expect(chips.map(({ term }) => term)).toStrictEqual([
      "ALPHA",
      "beta",
      "gamma",
    ]);
  });

  it("does not draw an added term that is removed too, as the run drops it", () => {
    const chips = visibleTerms(profile, {
      removedTerms: ["delta"],
      addedTerms: ["delta"],
    });
    expect(chips.map(({ term }) => term)).toStrictEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("carries the term in the remove button's arguments", () => {
    const [first] = visibleTerms(profile, NO_EDITS);
    expect(first?.removeRef).toStrictEqual({
      id: "research-helper-search-recommend-term-remove",
      args: { term: "alpha" },
    });
  });

  it("removing a profile's term keeps it for undoing, once", () => {
    const once = editsWithRemoved(NO_EDITS, "alpha");
    expect(once).toStrictEqual({ removedTerms: ["alpha"], addedTerms: [] });
    expect(editsWithRemoved(once, "ALPHA")).toBe(once);
  });

  it("removing an added term only drops it", () => {
    expect(
      editsWithRemoved({ removedTerms: [], addedTerms: ["delta"] }, "Delta"),
    ).toStrictEqual({ removedTerms: [], addedTerms: [] });
  });

  it("putting a term back takes it off the removed list, whatever its case", () => {
    expect(
      editsWithRestored({ removedTerms: ["alpha"], addedTerms: [] }, "ALPHA"),
    ).toStrictEqual({ removedTerms: [], addedTerms: [] });
  });

  it("adds a new term, cleaned", () => {
    expect(
      editsWithAdded(profile, NO_EDITS, "  lipid \t nanoparticle\u0007 "),
    ).toStrictEqual({ removedTerms: [], addedTerms: ["lipid nanoparticle"] });
  });

  it("adding a removed term puts it back, since a term that is both is dropped", () => {
    expect(
      editsWithAdded(
        profile,
        { removedTerms: ["alpha"], addedTerms: [] },
        "Alpha",
      ),
    ).toStrictEqual({ removedTerms: [], addedTerms: [] });
  });

  it("changes nothing for a blank, a punctuation-only or an already drawn term", () => {
    const edits = { removedTerms: [], addedTerms: ["delta"] };
    expect(editsWithAdded(profile, edits, "   ")).toBe(edits);
    expect(editsWithAdded(profile, edits, "-- !")).toBe(edits);
    expect(editsWithAdded(profile, edits, "BETA")).toBe(edits);
    expect(editsWithAdded(profile, edits, "delta")).toBe(edits);
  });

  it("adds a term of the profile's that is too light to be a chip", () => {
    const big = profileOf({ termWeights: weights(RECOMMEND_TERMS_SHOWN + 1) });
    const light = `term-${String(RECOMMEND_TERMS_SHOWN)}`;
    expect(editsWithAdded(big, NO_EDITS, light).addedTerms).toStrictEqual([
      light,
    ]);
  });

  it("cleanTerm leaves ordinary text alone", () => {
    expect(cleanTerm("α-synuclein (PD)")).toBe("α-synuclein (PD)");
  });
});

describe("the panel", () => {
  it("shows the focus, the counted names and the queries over these edits", () => {
    const view = profileView(
      profileOf({
        narrative: "A focus.",
        termWeights: { alpha: 3, beta: 2 },
      }),
      { removedTerms: ["alpha"], addedTerms: [] },
      undefined,
      15,
    );
    expect(view.focus).toBe("A focus.");
    expect(view.authors).toStrictEqual(["Cullis (9)", "Anderson (7)"]);
    expect(view.venues).toStrictEqual(["Nature (4)"]);
    expect(view.queries).toStrictEqual(['"beta"']);
    expect(view.removed).toStrictEqual([
      {
        term: "alpha",
        restoreRef: {
          id: "research-helper-search-recommend-term-restore",
          args: { term: "alpha" },
        },
      },
    ]);
  });

  it("names no more than ten authors", () => {
    const view = profileView(
      profileOf({
        topAuthors: Array.from({ length: 12 }, (_, at) => ({
          name: `A${String(at)}`,
          count: 1,
        })),
      }),
      NO_EDITS,
      undefined,
      15,
    );
    expect(view.authors).toHaveLength(10);
  });

  it("says what goes to the literature databases, with the code's own limits", () => {
    const { egress } = profileView(profileOf(), NO_EDITS, undefined, 15);
    expect(egress).toStrictEqual([
      {
        id: "research-helper-search-recommend-egress-notice",
        args: {
          papers: 15,
          dismissed: MAX_NEGATIVES,
          authors: RECOMMEND_WATCH_AUTHORS,
        },
      },
      {
        id: "research-helper-search-recommend-egress-sources",
        args: undefined,
      },
    ]);
  });

  it.each([
    ["no-provider", "research-helper-search-recommend-heuristic-no-provider"],
    ["too-large", "research-helper-search-recommend-heuristic-too-large"],
    ["unusable-answer", "research-helper-search-recommend-heuristic"],
    [undefined, "research-helper-search-recommend-heuristic"],
  ] as const)("words a heuristic profile by its reason: %s", (reason, id) => {
    expect(profileView(profileOf(), NO_EDITS, reason, 15).heuristic?.id).toBe(
      id,
    );
  });

  it("has no heuristic line for a model's profile", () => {
    expect(
      profileView(profileOf({ origin: "llm" }), NO_EDITS, undefined, 15)
        .heuristic,
    ).toBeUndefined();
  });
});

describe("Build profile and Find papers", () => {
  it("starts nothing when the window opens, and offers only Build", () => {
    const w = world();
    w.opened();
    expect(w.execute).not.toHaveBeenCalled();
    expect(w.openJob).not.toHaveBeenCalled();
    expect(w.last().recommend).toStrictEqual({
      collectionName: "mRNA LNP",
      profile: undefined,
      canBuild: true,
      canFind: false,
      keyRequestUrl: undefined,
      dismissedKeys: [],
      dismissedAsked: false,
      listNote: undefined,
    });
  });

  it("Build profile starts a profile-only run", async () => {
    const w = world();
    w.opened();
    await w.host.build();
    expect(w.inputs).toStrictEqual([
      {
        libraryID: LIBRARY_ID,
        collectionKey: COLLECTION_KEY,
        mode: "profile-only",
      },
    ]);
  });

  it("opens the job on the collection, so its privacy override applies, and draws only at the end", async () => {
    const w = world();
    w.opened();
    await w.host.build();
    expect(w.openOptions[0]).toMatchObject({
      pipelineId: "recommend",
      collection: { libraryID: LIBRARY_ID, collectionKey: COLLECTION_KEY },
      openOn: "completion",
    });
  });

  it("Find papers is disabled until a profile is shown, and refuses without one", async () => {
    const w = world();
    w.opened();
    await w.host.find();
    expect(w.execute).not.toHaveBeenCalled();
    expect(w.warn).toHaveBeenCalled();
    expect(w.last().recommend.canFind).toBe(false);

    await w.host.build();
    expect(w.last().recommend.canFind).toBe(true);
    expect(w.last().recommend.profile).toBeDefined();
  });

  it("disables both buttons while a run goes", async () => {
    let finish: (output: RecommendOutput) => void = () => undefined;
    const w = world(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    w.opened();
    const build = w.host.build();
    await flush();
    expect(w.last().running).toBe(true);
    expect(w.last().recommend.canBuild).toBe(false);
    expect(w.last().recommend.canFind).toBe(false);
    expect(w.last().status?.id).toBe(
      "research-helper-search-recommend-status-building",
    );
    finish(profileEnding());
    await build;
    expect(w.last().running).toBe(false);
    expect(w.last().recommend.canBuild).toBe(true);
    expect(w.last().recommend.canFind).toBe(true);
  });

  it("a removed term reaches the pipeline's input, with the profile on screen", async () => {
    const profile = profileOf({ termWeights: { alpha: 2, beta: 1 } });
    const w = world((input) =>
      input.mode === "profile-only"
        ? profileEnding(profile)
        : rowsEnding([rowOf(1)]),
    );
    w.opened();
    await w.host.build();
    w.host.removeTerm("alpha");
    w.host.addTerm("delta");
    expect(
      w.last().recommend.profile?.terms.map(({ term }) => term),
    ).toStrictEqual(["delta", "beta"]);
    expect(w.last().recommend.profile?.queries).toStrictEqual([
      '"delta" OR "beta"',
    ]);
    await w.host.find();
    const sent = w.inputs[1] as RecommendEditedProfileInput;
    expect(sent.mode).toBe("edited-profile");
    expect(sent.profile).toBe(profile);
    expect(sent.edits).toStrictEqual({
      removedTerms: ["alpha"],
      addedTerms: ["delta"],
    });
    expect(sent.showDismissed).toBe(false);
    expect(sent.peerReviewedOnly).toBe(false);
    expect(sent.exploration).toBe(RECOMMEND_DEFAULT_EXPLORATION);
  });

  it("starts from the profile's stored edits, and a later build keeps the window's", async () => {
    const stored = { removedTerms: ["term-0"], addedTerms: [] };
    const w = world(() => profileEnding(profileOf({ userEdits: stored })));
    w.opened();
    await w.host.build();
    expect(w.last().recommend.profile?.removed[0]?.term).toBe("term-0");
    await w.host.build();
    expect(w.last().recommend.profile?.removed[0]?.term).toBe("term-0");

    w.host.restoreTerm("term-0");
    await w.host.build();
    expect(w.last().recommend.profile?.removed).toStrictEqual([]);
  });

  it("does nothing to the edits before a profile is shown", () => {
    const w = world();
    w.opened();
    w.host.removeTerm("alpha");
    w.host.addTerm("delta");
    w.host.restoreTerm("alpha");
    expect(w.last().recommend.profile).toBeUndefined();
    // Nothing to draw, so nothing is published.
    expect(w.states).toHaveLength(2);
  });

  it("refuses a pasted key, says so, and keeps neither it nor the lines already there", async () => {
    const w = world(() =>
      profileEnding(profileOf(), {
        warningId: "research-helper-recommend-profile-unusable",
      }),
    );
    w.opened();
    await w.host.build();
    const key = `sk-or-v1-${"a".repeat(40)}`;
    w.host.addTerm(`  ${key} `);
    const state = w.last();
    expect(
      state.recommend.profile?.terms.map(({ term }) => term),
    ).not.toContain(key);
    expect(JSON.stringify(state)).not.toContain(key);
    expect(state.warnings.map(({ id }) => id)).toStrictEqual([
      "research-helper-recommend-profile-unusable",
      "research-helper-search-recommend-term-refused",
    ]);
    // The next edit clears the refusal and keeps the run's own line.
    w.host.addTerm("delta");
    expect(w.last().warnings.map(({ id }) => id)).toStrictEqual([
      "research-helper-recommend-profile-unusable",
    ]);
  });

  it("does not start a second run over a running one", async () => {
    let finish: (output: RecommendOutput) => void = () => undefined;
    const w = world(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    w.opened();
    const first = w.host.build();
    await flush();
    await w.host.build();
    expect(w.execute).toHaveBeenCalledTimes(1);
    finish(profileEnding());
    await first;
  });
});

describe("what a run's ending draws", () => {
  async function found(output: RecommendOutput) {
    const w = world((input) =>
      input.mode === "profile-only" ? profileEnding() : output,
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    return w;
  }

  it("rows, keeping the pipeline's order and its starting ticks", async () => {
    const w = await found(
      rowsEnding([
        rowOf(2, { inLibrary: true, checkedByDefault: false }),
        rowOf(1),
      ]),
    );
    expect(w.last().panel).toBe("results");
    expect(w.last().records).toStrictEqual([
      {
        key: "key-2",
        title: "Paper 2",
        authors: [{ family: "Author2" }],
        year: 2024,
        sourceLabels: [],
        typeLabel: "",
        doi: "",
        existing: true,
        startsTicked: false,
        recommended: true,
        reasons: [
          {
            id: "research-helper-search-recommend-reason-similarity",
            args: undefined,
          },
        ],
        preprint: false,
      },
      {
        key: "key-1",
        title: "Paper 1",
        authors: [{ family: "Author1" }],
        year: 2024,
        sourceLabels: [],
        typeLabel: "",
        doi: "",
        existing: false,
        startsTicked: true,
        recommended: true,
        reasons: [
          {
            id: "research-helper-search-recommend-reason-similarity",
            args: undefined,
          },
        ],
        preprint: false,
      },
    ]);
    expect(w.last().recordsRevision).toBeGreaterThan(0);
    expect(w.done).toHaveBeenCalledWith("succeeded", undefined);
  });

  it("bumps the revision for the finished rows, so the document applies them", async () => {
    const w = await found(rowsEnding([rowOf(1)]));
    expect(w.last().recordsRevision).toBe(
      (w.states.at(-2)?.recordsRevision ?? 0) + 1,
    );
  });

  it("a run with nothing to say about its profile has no warning line", async () => {
    const w = await found(rowsEnding([rowOf(1)]));
    expect(w.last().warnings).toStrictEqual([]);
  });

  it("no rows, with its own line", async () => {
    const w = await found(rowsEnding([]));
    expect(w.last().panel).toBe("empty");
    expect(w.last().emptyHeadline?.id).toBe(
      "research-helper-search-recommend-state-empty",
    );
  });

  it("a row with no year has no year", async () => {
    const row = rowOf(1);
    const w = await found(
      rowsEnding([
        {
          ...row,
          recommendation: {
            ...row.recommendation,
            work: { ...row.recommendation.work, publishedDate: undefined },
          },
        } as unknown as RecommendationRow,
      ]),
    );
    expect(w.last().records?.[0]).not.toHaveProperty("year");
  });

  it("one status row per generator, a failed one read as failed", async () => {
    const statuses = [
      [
        "recommendations",
        "no-key",
        "research-helper-search-related-source-no-key",
      ],
      [
        "similar",
        "not-indexed",
        "research-helper-search-related-source-not-indexed",
      ],
      [
        "forward-citations",
        "partial",
        "research-helper-search-recommend-source-partial",
      ],
      [
        "keyword-search",
        "could-not-ask",
        "research-helper-search-recommend-source-could-not-ask",
      ],
      [
        "author-watch",
        "rate-limited",
        "research-helper-search-related-source-rate-limited",
      ],
      [
        "author-watch",
        "over-budget",
        "research-helper-search-related-source-over-budget",
      ],
    ].map(([generator, state]) => ({
      generator,
      state,
      records: 0,
    }));
    const w = await found(
      rowsEnding([], {
        statuses: [
          ...statuses,
          { generator: "keyword-search", state: "answered", records: 3 },
          {
            generator: "similar",
            state: "failed",
            records: 0,
            errorCode: "RATE",
          },
          { generator: "similar", state: "failed", records: 0 },
        ],
      }),
    );
    const sources = w.last().sources;
    expect(sources[0]).toStrictEqual({
      sourceId: "recommendations",
      nameId: "research-helper-search-recommend-generator-recommendations",
      outcome: "succeeded",
      detail: {
        id: "research-helper-search-related-source-no-key",
        args: undefined,
      },
    });
    expect(sources.map(({ detail }) => detail.id)).toStrictEqual([
      "research-helper-search-related-source-no-key",
      "research-helper-search-related-source-not-indexed",
      "research-helper-search-recommend-source-partial",
      "research-helper-search-recommend-source-could-not-ask",
      "research-helper-search-related-source-rate-limited",
      "research-helper-search-related-source-over-budget",
      "research-helper-search-source-results",
      "research-helper-search-related-source-failed",
      "research-helper-search-related-source-failed",
    ]);
    expect(sources.map(({ outcome }) => outcome)).toStrictEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "failed",
      "succeeded",
      "succeeded",
      "failed",
      "failed",
    ]);
    expect(sources[6]?.detail.args).toStrictEqual({ count: 3 });
    expect(sources[7]?.detail.args).toStrictEqual({ code: "RATE" });
    expect(sources[8]?.detail.args).toStrictEqual({ code: "SOURCE" });
  });

  it("the key notice comes from the run, and a new run clears it", async () => {
    const w = await found(rowsEnding([rowOf(1)], { keyNotice: true }));
    expect(w.last().recommend.keyRequestUrl).toBe("https://example.org/key");
    await w.host.build();
    expect(w.last().recommend.keyRequestUrl).toBeUndefined();
  });

  // plan/00 §6 item 355(c): with a usable key the notice is asked to hide before any
  // run, while a run goes and after it, and not only once a run ends.
  it("with a key, every state the window is given asks the key notice to hide, from the opening on", async () => {
    const w = await found(rowsEnding([rowOf(1)], { keyNotice: false }));
    expect(w.states.length).toBeGreaterThan(3);
    expect(
      w.states.map((state) => state.recommend.keyRequestUrl),
    ).toStrictEqual(w.states.map(() => undefined));
  });

  it("a run after a keyless list asks the notice to hide as it starts, not at its end", async () => {
    let gate: ((output: RecommendOutput) => void) | undefined;
    let next: () => Promise<RecommendOutput> | RecommendOutput = () =>
      rowsEnding([rowOf(1)], { keyNotice: true });
    const w = world((input) =>
      input.mode === "profile-only" ? profileEnding() : next(),
    );
    w.opened();
    expect(w.last().recommend.keyRequestUrl).toBeUndefined();
    await w.host.build();
    expect(w.last().recommend.keyRequestUrl).toBeUndefined();
    await w.host.find();
    expect(w.last().recommend.keyRequestUrl).toBe("https://example.org/key");

    next = () =>
      new Promise<RecommendOutput>((resolve) => {
        gate = resolve;
      });
    const going = w.host.find();
    await flush();
    expect(w.last().running).toBe(true);
    expect(w.last().recommend.keyRequestUrl).toBeUndefined();
    gate?.(rowsEnding([rowOf(1)], { keyNotice: false }));
    await going;
    expect(w.last().running).toBe(false);
    expect(w.last().recommend.keyRequestUrl).toBeUndefined();
  });

  it("the notes about the profile are warning lines", async () => {
    const w = await found(
      rowsEnding([rowOf(1)], {
        warningId: "research-helper-recommend-profile-unusable",
        vectorsIncomplete: true,
        profileRebuilt: true,
      }),
    );
    expect(w.last().warnings.map(({ id }) => id)).toStrictEqual([
      "research-helper-recommend-profile-unusable",
      "research-helper-search-recommend-vectors-incomplete",
      "research-helper-search-recommend-profile-rebuilt",
    ]);
  });

  it("a rebuilt profile replaces the one on screen", async () => {
    const rebuilt = profileOf({ topVenues: [{ name: "Cell", count: 1 }] });
    const w = await found(rowsEnding([rowOf(1)], { profile: rebuilt }));
    expect(w.last().recommend.profile?.venues).toStrictEqual(["Cell (1)"]);
  });

  it("the heuristic reason of the run that built the profile", async () => {
    const w = world(() =>
      profileEnding(profileOf(), { heuristicReason: "too-large" }),
    );
    w.opened();
    await w.host.build();
    expect(w.last().recommend.profile?.heuristic?.id).toBe(
      "research-helper-search-recommend-heuristic-too-large",
    );
    expect(w.done).toHaveBeenCalledWith("succeeded", undefined);
  });

  it("a toast of the rows' count, in the window's words", async () => {
    const w = world((input) =>
      input.mode === "profile-only"
        ? profileEnding()
        : rowsEnding([rowOf(1), rowOf(2, { inLibrary: true })]),
    );
    w.model.host.connect({
      ...w.view,
      formatter: {
        formatMessages: (requests: readonly { id: string; args?: unknown }[]) =>
          Promise.resolve(
            requests.map(({ id, args }) => ({
              value: `${id} ${JSON.stringify(args)}`,
            })),
          ),
      } as never,
    });
    w.host.open(COLLECTION_ID);
    await w.host.build();
    await w.host.find();
    expect(w.done).toHaveBeenLastCalledWith(
      "succeeded",
      'research-helper-search-result-count {"total":2,"new":1}',
    );
  });

  it("no toast when the words cannot be formatted", async () => {
    const w = world((input) =>
      input.mode === "profile-only" ? profileEnding() : rowsEnding([rowOf(1)]),
    );
    w.model.host.connect({
      ...w.view,
      formatter: {
        formatMessages: () => Promise.reject(new Error("no bundle")),
      } as never,
    });
    w.host.open(COLLECTION_ID);
    await w.host.build();
    await w.host.find();
    expect(w.done).toHaveBeenLastCalledWith("succeeded", undefined);
  });

  it("a cancel's toast says so, in the window's words (2026-11-06)", async () => {
    const w = world((input) =>
      input.mode === "profile-only" ? profileEnding() : CANCELLED,
    );
    w.model.host.connect({
      ...w.view,
      formatter: {
        formatMessages: (requests: readonly { id: string }[]) =>
          Promise.resolve(requests.map(({ id }) => ({ value: id }))),
      } as never,
    });
    w.host.open(COLLECTION_ID);
    await w.host.build();
    await w.host.find();
    expect(w.done).toHaveBeenLastCalledWith(
      "cancelled",
      "research-helper-search-related-status-cancelled",
    );
  });

  it("a cancel keeps the profile and goes back to the first panel", async () => {
    const w = await found(CANCELLED);
    expect(w.last().panel).toBe("initial");
    expect(w.last().status?.id).toBe(
      "research-helper-search-related-status-cancelled",
    );
    expect(w.last().recommend.profile).toBeDefined();
    expect(w.last().recommend.canFind).toBe(true);
    expect(w.done).toHaveBeenLastCalledWith("cancelled", undefined);
  });

  it("publishes progress as a whole number, and only one that says something", async () => {
    let finish: (output: RecommendOutput) => void = () => undefined;
    const w = world(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    w.opened();
    const build = w.host.build();
    await flush();
    const profileBefore = w.last().recommend;
    w.emit({ fraction: 0.426 } as ProgressSnapshot);
    expect(w.last().progressPercent).toBe(43);
    expect(w.last().recommend).toBe(profileBefore);
    w.emit({ fraction: undefined } as ProgressSnapshot);
    expect(w.last().progressPercent).toBe(43);
    w.emit({ fraction: 2 } as ProgressSnapshot);
    expect(w.last().progressPercent).toBe(100);
    w.emit({ fraction: -1 } as ProgressSnapshot);
    expect(w.last().progressPercent).toBe(0);
    finish(profileEnding());
    await build;
    expect(w.unsubscribed).toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("too few papers fills $count and offers no retry", () => {
    const view = recommendFailureView(
      failedEnding({
        error: {
          code: "TOO_FEW_ITEMS",
          messageKey: "rh-error-recommend-too-few-items",
          detail: "x",
          retryable: false,
        },
        tooFewItems: { itemCount: 3, minimum: 5 },
      }) as never,
    );
    expect(view.headline).toStrictEqual({
      id: "rh-error-recommend-too-few-items",
      args: { count: 3 },
    });
    expect(view.retry).toBe(false);
    expect(view.details.length).toBeGreaterThan(0);
  });

  it("too few papers offers no retry even if the error calls itself retryable", () => {
    const view = recommendFailureView(
      failedEnding({ tooFewItems: { itemCount: 3, minimum: 5 } }) as never,
    );
    expect(view.retry).toBe(false);
  });

  it("any other failure has this mode's headline, not the related mode's", () => {
    const view = recommendFailureView(failedEnding() as never);
    expect(view.headline.id).toBe(
      "research-helper-search-recommend-state-failed",
    );
    expect(view.retry).toBe(true);
    expect(JSON.stringify(view)).not.toContain("a detail");
  });

  it("a failed Find keeps the profile and the edits, and Retry repeats Find", async () => {
    let fail = true;
    const w = world((input) => {
      if (input.mode === "profile-only") return profileEnding();
      if (fail) {
        fail = false;
        return failedEnding({
          statuses: [{ generator: "similar", state: "failed", records: 0 }],
        });
      }
      return rowsEnding([rowOf(1)]);
    });
    w.opened();
    await w.host.build();
    w.host.removeTerm("term-0");
    await w.host.find();
    expect(w.last().panel).toBe("error");
    expect(w.last().sources).toHaveLength(1);
    expect(w.last().recommend.profile?.removed[0]?.term).toBe("term-0");
    expect(w.last().recommend.canFind).toBe(true);
    expect(w.done).toHaveBeenLastCalledWith("failed", undefined);
    await w.host.retry();
    expect(w.inputs.map(({ mode }) => mode)).toStrictEqual([
      "profile-only",
      "edited-profile",
      "edited-profile",
    ]);
    expect(w.last().panel).toBe("results");
    expect(w.last().error).toBeUndefined();
  });

  it("Retry after a failed Build repeats Build, and Find stays off", async () => {
    let fail = true;
    const w = world(() => {
      if (fail) {
        fail = false;
        return failedEnding();
      }
      return profileEnding();
    });
    w.opened();
    await w.host.build();
    expect(w.last().recommend.canFind).toBe(false);
    await w.host.retry();
    expect(w.inputs.map(({ mode }) => mode)).toStrictEqual([
      "profile-only",
      "profile-only",
    ]);
    expect(w.last().recommend.canFind).toBe(true);
  });

  it("a collection gone at a later open takes Find papers away, with the profile still drawn", async () => {
    const w = world();
    w.opened();
    await w.host.build();
    expect(w.last().recommend.canFind).toBe(true);
    w.host.open(COLLECTION_ID + 1);
    expect(w.last().recommend.profile).toBeDefined();
    expect(w.last().recommend.canFind).toBe(false);
  });

  it("a collection that is gone says so, and nothing can start", async () => {
    const w = world(undefined, { collection: false });
    w.model.host.connect(w.view);
    w.host.open(COLLECTION_ID);
    expect(w.last().panel).toBe("error");
    expect(w.last().error?.headline.id).toBe(
      "research-helper-search-recommend-collection-gone",
    );
    expect(w.last().error?.retry).toBe(false);
    expect(w.last().recommend.canBuild).toBe(false);
    await w.host.build();
    await w.host.find();
    await w.host.retry();
    expect(w.execute).not.toHaveBeenCalled();
  });

  it("an input that does not validate starts nothing", async () => {
    const w = world((input) =>
      input.mode === "profile-only"
        ? profileEnding(profileOf({ id: "another-collection" }))
        : rowsEnding([]),
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    expect(w.execute).toHaveBeenCalledTimes(1);
    expect(w.last().panel).toBe("error");
    expect(w.last().error?.headline.id).toBe(
      "research-helper-search-recommend-state-failed",
    );
    expect(w.last().running).toBe(false);
  });

  it("a job that will not open is drawn and thrown, and the window can go on", async () => {
    const w = world();
    w.opened();
    w.openJob.mockImplementationOnce(() =>
      Promise.reject(new Error("no queue")),
    );
    await expect(w.host.build()).rejects.toThrow("no queue");
    expect(w.last().panel).toBe("error");
    expect(w.last().error?.retry).toBe(true);
    expect(w.last().recommend.canBuild).toBe(true);
    await w.host.build();
    expect(w.last().recommend.canFind).toBe(true);
  });

  it("a defect below execute closes the surfaces, is drawn and thrown", async () => {
    const w = world(() => Promise.reject(new Error("a defect")));
    w.opened();
    await expect(w.host.build()).rejects.toThrow("a defect");
    expect(w.dispose).toHaveBeenCalled();
    expect(w.unsubscribed).toHaveBeenCalled();
    expect(w.last().panel).toBe("error");
    expect(w.last().running).toBe(false);
    expect(w.last().recommend.canBuild).toBe(true);
  });
});

describe("the cost question", () => {
  it("opens the dialog when due, and passes the answer on", async () => {
    const { deps, settle, openDialog } = confirmDeps();
    const request = confirmRequest();
    const result = await confirmProfileCall(deps, request);
    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog.mock.calls[0]?.[0]).toMatchObject({
      mode: "preflight",
      providerName: "OpenRouter",
      confirmAboveCents: 10,
      fullTextAutoMaxPapers: 5,
      ceilingDowngrade: undefined,
      estimate: request.estimate,
      disclosure: request.disclosure,
      session: request.session,
    });
    expect(settle).toHaveBeenCalledWith(request.disclosure, "confirmed");
    expect(result).toStrictEqual({
      answer: { kind: "run", raise: undefined, dontAskAgain: true },
      notice: undefined,
    });
  });

  it("skips the dialog for a routine run under the threshold, and gives the price", async () => {
    const { deps, settle, openDialog } = confirmDeps();
    const result = await confirmProfileCall(
      deps,
      confirmRequest({
        confirmation: { ask: false, reasons: [] },
        estimate: {
          selected: { calls: 1, costUsd: 0.01, items: [], counts: {} },
        } as never,
      }),
    );
    expect(openDialog).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(result.answer).toStrictEqual({
      kind: "run",
      raise: undefined,
      dontAskAgain: false,
    });
    expect(result.notice?.id).toBeDefined();
  });

  it("passes a raised ceiling on, and offers no downgrade even above a ceiling", async () => {
    const raise = { ceiling: "run", limitUsd: 2 } as const;
    const { deps, openDialog } = confirmDeps(() =>
      Promise.resolve({
        kind: "run",
        plan: "selected",
        raise,
        dontAskAgain: false,
      } as never),
    );
    const result = await confirmProfileCall(
      deps,
      confirmRequest({ ceilingSelected: { ceiling: "run" } as never }),
    );
    expect(result.answer).toStrictEqual({
      kind: "run",
      raise,
      dontAskAgain: false,
    });
    expect(openDialog.mock.calls[0]?.[0]).toMatchObject({
      ceilingSelected: { ceiling: "run" },
    });
    expect(
      (openDialog.mock.calls[0]?.[0] as { ceilingDowngrade?: unknown })
        .ceilingDowngrade,
    ).toBeUndefined();
  });

  it("a skipped dialog over nothing to spend has no price line", async () => {
    const { deps } = confirmDeps();
    const result = await confirmProfileCall(
      deps,
      confirmRequest({
        confirmation: { ask: false, reasons: [] },
        estimate: {
          selected: { calls: 0, costUsd: 0, items: [], counts: {} },
        } as never,
      }),
    );
    expect(result.notice).toBeUndefined();
  });

  it("a user's no, or a dialog that cannot open, runs nothing and settles as a refusal", async () => {
    for (const outcome of [
      () => Promise.resolve<CostDialogOutcome>({ kind: "cancelled" }),
      () => Promise.reject(new Error("no window")),
    ]) {
      const { deps, settle } = confirmDeps(outcome);
      const request = confirmRequest();
      const result = await confirmProfileCall(deps, request);
      expect(result.answer).toStrictEqual({ kind: "cancelled" });
      expect(settle).toHaveBeenCalledWith(request.disclosure, "cancelled");
      expect(settle).toHaveBeenCalledTimes(1);
    }
  });

  it("a window gone answers a question still open as cancelled", async () => {
    const { deps, settle } = confirmDeps(() => new Promise(() => undefined));
    let free: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      free = resolve;
    });
    const request = confirmRequest();
    const pending = confirmProfileCall(deps, request, released);
    free();
    expect((await pending).answer).toStrictEqual({ kind: "cancelled" });
    expect(settle).toHaveBeenCalledWith(request.disclosure, "cancelled");
  });

  it("the run's surface draws a skipped dialog's price", async () => {
    const w = world(async (input, surface) => {
      await surface.confirm(
        confirmRequest({
          confirmation: { ask: false, reasons: [] },
          estimate: {
            selected: { calls: 1, costUsd: 0.01, items: [], counts: {} },
          } as never,
        }),
      );
      return profileEnding();
    });
    w.opened();
    await w.host.build();
    expect(w.last().notices).toHaveLength(1);
  });

  it("Cancel and a closed window release the run's question", async () => {
    for (const leave of ["cancel", "detach"] as const) {
      const never = confirmDeps(() => new Promise(() => undefined));
      let answer: unknown;
      const w = world(
        async (input, surface) => {
          answer = await surface.confirm(confirmRequest());
          return CANCELLED;
        },
        { confirm: never.deps },
      );
      const detach = w.host.connect(w.view);
      w.host.open(COLLECTION_ID);
      const build = w.host.build();
      await flush();
      if (leave === "cancel") w.host.cancel();
      else detach();
      await build;
      expect(answer, leave).toStrictEqual({ kind: "cancelled" });
      expect(never.settle, leave).toHaveBeenCalledTimes(1);
    }
  });

  it("the budget question goes to the ceiling dialog, and a closed window says cancel", async () => {
    const question = { reason: "budget-stop" } as RecommendBudgetQuestion;
    let said: unknown;
    const resumed = world(
      async (input, surface) => {
        said = await surface.ask(question);
        return profileEnding();
      },
      { askBudget: () => Promise.resolve("resume") },
    );
    resumed.opened();
    await resumed.host.build();
    expect(said).toBe("resume");

    const open = world(
      async (input, surface) => {
        said = await surface.ask(question);
        return CANCELLED;
      },
      { askBudget: () => new Promise(() => undefined) },
    );
    open.opened();
    const build = open.host.build();
    await flush();
    open.host.cancel();
    await build;
    expect(said).toBe("cancel");
  });
});

describe("the window's life", () => {
  it("connect draws a clean window and cancels a run still going", async () => {
    let finish: (output: RecommendOutput) => void = () => undefined;
    const w = world(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    w.opened();
    const build = w.host.build();
    await flush();
    const seen = w.states.length;
    w.host.connect(w.view);
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    expect(w.last()).toStrictEqual(initialRecommendViewState());
    expect(w.states).toHaveLength(seen + 1);
    finish(profileEnding());
    await build;
    // The run's answer is dropped, so no profile came back and no toast rose.
    expect(w.states).toHaveLength(seen + 1);
    expect(w.last().recommend.profile).toBeUndefined();
    expect(w.done).not.toHaveBeenCalled();
    expect(w.dispose).toHaveBeenCalled();
  });

  it("a second window reads the stored edits, though the first was touched", async () => {
    const stored = { removedTerms: ["term-1"], addedTerms: [] };
    const w = world(() => profileEnding(profileOf({ userEdits: stored })));
    w.opened();
    await w.host.build();
    w.host.removeTerm("term-0");
    w.opened();
    await w.host.build();
    expect(
      w.last().recommend.profile?.removed.map(({ term }) => term),
    ).toStrictEqual(["term-1"]);
  });

  it("Retry in a second window does not repeat the first one's Find", async () => {
    const w = world((input) =>
      input.mode === "profile-only" ? profileEnding() : rowsEnding([]),
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    w.opened();
    await w.host.retry();
    expect(w.inputs.map(({ mode }) => mode)).toStrictEqual([
      "profile-only",
      "edited-profile",
      "profile-only",
    ]);
  });

  it("a second window starts without the first one's profile or edits", async () => {
    const w = world();
    w.opened();
    await w.host.build();
    w.host.removeTerm("term-0");
    w.opened();
    expect(w.last().recommend.profile).toBeUndefined();
    await w.host.build();
    expect(w.last().recommend.profile?.removed).toStrictEqual([]);
    await w.host.retry();
    expect(w.inputs.at(-1)?.mode).toBe("profile-only");
  });

  it("an old window's detach does not take the new window's view away", async () => {
    const w = world();
    const detachOld = w.host.connect(w.view);
    w.host.connect(w.view);
    const fresh: RecommendViewState[] = [];
    const detachNew = w.host.connect({ render: (s) => fresh.push(s) });
    detachOld();
    w.host.open(COLLECTION_ID);
    expect(fresh.at(-1)?.recommend.collectionName).toBe("mRNA LNP");
    detachNew();
    const count = fresh.length;
    w.host.open(COLLECTION_ID);
    expect(fresh).toHaveLength(count);
  });

  it("a window closed during a run cancels it and draws nothing more", async () => {
    let finish: (output: RecommendOutput) => void = () => undefined;
    const w = world(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const detach = w.host.connect(w.view);
    w.host.open(COLLECTION_ID);
    const build = w.host.build();
    await flush();
    detach();
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    const seen = w.states.length;
    finish(profileEnding());
    await build;
    expect(w.states).toHaveLength(seen);
    expect(w.done).not.toHaveBeenCalled();
  });

  it("Cancel asks the token, and the run says how it ended", async () => {
    let finish: (output: RecommendOutput) => void = () => undefined;
    const w = world(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    w.opened();
    const build = w.host.build();
    await flush();
    w.host.cancel();
    expect(w.tokens[0]?.isCancellationRequested).toBe(true);
    finish(CANCELLED);
    await build;
    expect(w.done).toHaveBeenCalledWith("cancelled", undefined);
  });

  it("never allows Find papers without a profile, in any state it publishes", async () => {
    const w = world((input) =>
      input.mode === "profile-only" ? failedEnding() : rowsEnding([]),
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    expect(w.states.length).toBeGreaterThan(2);
    for (const state of w.states) {
      if (state.recommend.canFind) {
        expect(state.recommend.profile).toBeDefined();
      }
    }
  });
});

describe("the menu entry", () => {
  /** The context a menu hook gets, over a window with this selection. */
  function contextOf(ids: readonly number[]) {
    const host = {
      openDialog: () => undefined,
      ZoteroPane: {
        getSelectedCollections: () => ids.map((id) => ({ id })),
      },
    };
    const seen: boolean[] = [];
    const context = {
      menuElem: { ownerDocument: { defaultView: host } },
      setVisible: (visible: boolean) => seen.push(visible),
    } as unknown as _ZoteroTypes.MenuManager.LibraryMenuContext;
    return { host, seen, context };
  }

  function entriesOf(commands: Partial<SearchMenuCommands>) {
    const options = collectionMenuOptions({
      openSearchWindow: () => undefined,
      onError: () => undefined,
      ...commands,
    });
    return options.menus[0]?.menus ?? [];
  }
  const isRecommend = (entry: { readonly l10nID?: string }): boolean =>
    entry.l10nID === L10N_MENU_COLLECTION_RECOMMEND;
  const open = () => undefined;

  it("is left out while the preference is off, or nothing can open its window", () => {
    expect(
      entriesOf({
        recommendEnabled: () => false,
        openRecommendWindow: open,
      }).some(isRecommend),
    ).toBe(false);
    expect(entriesOf({ openRecommendWindow: open }).some(isRecommend)).toBe(
      false,
    );
    expect(entriesOf({ recommendEnabled: () => true }).some(isRecommend)).toBe(
      false,
    );
  });

  it("is the search group's last entry when on", () => {
    const entries = entriesOf({
      recommendEnabled: () => true,
      openRecommendWindow: open,
    });
    expect(entries.at(-1)?.l10nID).toBe(L10N_MENU_COLLECTION_RECOMMEND);
    expect(entries.filter(isRecommend)).toHaveLength(1);
  });

  it("shows for one collection only, and goes when the preference goes off", () => {
    let enabled = true;
    const [entry] = entriesOf({
      recommendEnabled: () => enabled,
      openRecommendWindow: open,
    }).filter(isRecommend);
    const shown = (ids: readonly number[]) => {
      const { seen, context } = contextOf(ids);
      entry?.onShowing?.(new Event("popupshowing"), context);
      return seen;
    };
    expect(shown([1])).toStrictEqual([true]);
    expect(shown([1, 2])).toStrictEqual([false]);
    expect(shown([])).toStrictEqual([false]);
    enabled = false;
    expect(shown([1])).toStrictEqual([false]);
  });

  it("opens its window on the one collection, and reports a failed visibility check", () => {
    const calls: unknown[][] = [];
    const errors: string[] = [];
    const [entry] = entriesOf({
      recommendEnabled: () => {
        if (calls.length > 0) throw new Error("no preference store");
        return true;
      },
      openRecommendWindow: (host, collectionID) => {
        calls.push([host, collectionID]);
      },
      onError: (text) => {
        errors.push(text);
      },
    }).filter(isRecommend);
    const { host, context } = contextOf([4243]);
    entry?.onCommand?.(new Event("command"), context);
    expect(calls).toStrictEqual([[host, 4243]]);
    entry?.onShowing?.(new Event("popupshowing"), context);
    expect(errors).toStrictEqual(["Recommend entry visibility check failed"]);
  });
});

describe("P5-T27: the words of a row", () => {
  const specter = {
    signals: { similarity: 0.6 },
    similaritySpace: "specter_v2",
  };
  const lexical = { signals: { similarity: 0.6 }, similaritySpace: "lexical" };
  const refs = (
    reasons: readonly Record<string, unknown>[],
    base: Record<string, unknown> = specter,
  ) =>
    reasonRefs({ reasons, ...base } as unknown as Parameters<
      typeof reasonRefs
    >[0]);
  const P = "research-helper-search-recommend-";

  it.each([
    ["recommended-by-semantic-scholar", "reason-recommended"],
    ["similarity", "reason-similarity"],
    ["recency", "reason-recency"],
    ["velocity", "reason-velocity"],
    ["novelty", "reason-novelty"],
    ["venueAffinity", "reason-venue"],
    ["generatorAgreement", "reason-agreement"],
    ["coupling", "reason-coupling"],
  ])("%s reads as its own message on SPECTER2", (id, wording) => {
    expect(refs([{ id }]).map((ref) => ref.id)).toStrictEqual([P + wording]);
  });

  it("gives the count and the names as arguments, joined and counted", () => {
    expect(
      refs([
        { id: "cites-collection", count: 3 },
        { id: "author-in-collection", names: ["Kim", "Sato"] },
      ]),
    ).toStrictEqual([
      { id: `${P}reason-cites`, args: { count: 3 } },
      { id: `${P}reason-author`, args: { names: "Kim, Sato", count: 2 } },
    ]);
  });

  it("keeps the pipeline's order", () => {
    expect(
      refs([{ id: "recency" }, { id: "coupling" }, { id: "velocity" }]).map(
        (ref) => ref.id,
      ),
    ).toStrictEqual([
      `${P}reason-recency`,
      `${P}reason-coupling`,
      `${P}reason-velocity`,
    ]);
  });

  it("does not put novelty on a row on the word space (decision 5)", () => {
    expect(
      refs([{ id: "novelty" }, { id: "recency" }], lexical).map(
        (ref) => ref.id,
      ),
    ).toStrictEqual([`${P}reason-recency`]);
  });

  it("names the basic similarity on the word space (decision 6)", () => {
    expect(
      refs([{ id: "similarity" }], lexical).map((ref) => ref.id),
    ).toStrictEqual([`${P}reason-similarity-basic`]);
  });

  it("never says close of a row that read 0, in either space (decision 6)", () => {
    for (const space of ["specter_v2", "lexical"]) {
      expect(
        refs([{ id: "similarity" }], {
          signals: { similarity: 0 },
          similaritySpace: space,
        }).map((ref) => ref.id),
      ).toStrictEqual([`${P}reason-found`]);
    }
  });

  it("never leaves the column empty: a word-space row left with nothing, and no reasons", () => {
    expect(
      refs([{ id: "novelty" }], lexical).map((ref) => ref.id),
    ).toStrictEqual([`${P}reason-found`]);
    expect(refs([]).map((ref) => ref.id)).toStrictEqual([`${P}reason-found`]);
  });

  it("offers authorAffinity on no row, because the phrase says it", () => {
    expect(refs([{ id: "authorAffinity" }]).map((ref) => ref.id)).toStrictEqual(
      [`${P}reason-found`],
    );
  });

  it("reads missing arguments as nothing rather than failing", () => {
    expect(
      refs([{ id: "cites-collection" }, { id: "author-in-collection" }]),
    ).toStrictEqual([
      { id: `${P}reason-cites`, args: { count: 0 } },
      { id: `${P}reason-author`, args: { names: "", count: 0 } },
    ]);
  });

  it("reads the slider as the pipeline does, and a value no control makes as the default", () => {
    expect(explorationOf(25)).toBe(0.25);
    expect(explorationOf(0)).toBe(0);
    expect(explorationOf(100)).toBe(1);
    expect(explorationOf(140)).toBe(1);
    expect(explorationOf(-5)).toBe(0);
    expect(explorationOf(Number.NaN)).toBe(RECOMMEND_DEFAULT_EXPLORATION);
    expect(explorationOf(Number.POSITIVE_INFINITY)).toBe(
      RECOMMEND_DEFAULT_EXPLORATION,
    );
    expect(RECOMMEND_DEFAULT_EXPLORATION).toBe(RECOMMEND_DEFAULT_SLIDER / 100);
  });
});

describe("P5-T27: the groups", () => {
  const topic = (n: number, topicIndex?: number) =>
    rowOf(n, {
      recommendation: {
        ...rowOf(n).recommendation,
        ...(topicIndex !== undefined && { topicIndex }),
      },
    });
  const keysOf = (rows: ReturnType<typeof groupedRows>) =>
    rows.map(({ row }) => row.recommendation.work.workKey);
  const twoTopics = {
    centroids: [[1], [2]],
  } as unknown as Partial<CollectionProfile>;
  const P = "research-helper-search-recommend-";

  it.each([
    ["no centroid", []],
    ["one centroid", [[1]]],
  ])(
    "with %s, one list in its own order and no heading",
    (_name, centroids) => {
      const grouped = groupedRows(
        [topic(2, 0), topic(1, 1), topic(3)],
        profileOf({ centroids } as unknown as Partial<CollectionProfile>),
      );
      expect(keysOf(grouped)).toStrictEqual(["key-2", "key-1", "key-3"]);
      expect(grouped.every(({ group }) => group === undefined)).toBe(true);
    },
  );

  it("stands the groups in the order of their best row, keeping the order within each", () => {
    const grouped = groupedRows(
      [topic(1, 1), topic(2, 0), topic(3, 1), topic(4, 0)],
      profileOf(twoTopics),
    );
    expect(keysOf(grouped)).toStrictEqual(["key-1", "key-3", "key-2", "key-4"]);
    expect(grouped.map(({ group }) => group?.key)).toStrictEqual([
      "1",
      "1",
      "0",
      "0",
    ]);
  });

  it("puts a row with no topic last, even when it came first, under its own heading", () => {
    const grouped = groupedRows(
      [topic(1), topic(2, 0), topic(3)],
      profileOf(twoTopics),
    );
    expect(keysOf(grouped)).toStrictEqual(["key-2", "key-1", "key-3"]);
    expect(grouped[1]?.group).toStrictEqual({
      key: "none",
      ref: { id: `${P}group-none`, args: undefined },
    });
  });

  it("numbers a topic from 1 when the profile has no labels", () => {
    const [first] = groupedRows([topic(1, 1)], profileOf(twoTopics));
    expect(first?.group).toStrictEqual({
      key: "1",
      ref: { id: `${P}group-numbered`, args: { number: 2 } },
    });
  });

  it("uses the label as text", () => {
    const [first] = groupedRows(
      [topic(1, 1)],
      profileOf({
        ...twoTopics,
        centroidLabels: ["liver", "<b>lipid</b>"],
      } as unknown as Partial<CollectionProfile>),
    );
    expect(first?.group).toStrictEqual({ key: "1", label: "<b>lipid</b>" });
  });

  it("reads a blank label as a number", () => {
    const [first] = groupedRows(
      [topic(1, 0)],
      profileOf({
        ...twoTopics,
        centroidLabels: ["  ", "lipid"],
      } as unknown as Partial<CollectionProfile>),
    );
    expect(first?.group?.ref?.id).toBe(`${P}group-numbered`);
  });

  it("drops a label the user has removed, as the term comparison reads it (decision 3)", () => {
    const profile = profileOf({
      ...twoTopics,
      centroidLabels: ["liver", "lipid"],
      userEdits: { removedTerms: ["LIVER"], addedTerms: [] },
    } as unknown as Partial<CollectionProfile>);
    const [stale, kept] = groupedRows([topic(1, 0), topic(2, 1)], profile);
    expect(stale?.group).toStrictEqual({
      key: "0",
      ref: { id: `${P}group-numbered`, args: { number: 1 } },
    });
    expect(kept?.group).toStrictEqual({ key: "1", label: "lipid" });
  });
});

describe("P5-T27: what the window draws of a list", () => {
  const P = "research-helper-search-recommend-";

  async function foundWith(
    output: RecommendOutput,
    options: Parameters<typeof world>[1] = {},
  ) {
    const w = world(
      (input) => (input.mode === "profile-only" ? profileEnding() : output),
      options,
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    return w;
  }

  it("hands the pipeline the controls Find papers read", async () => {
    const w = world();
    w.opened();
    await w.host.build();
    await w.host.find({
      slider: 60,
      peerReviewedOnly: true,
      showDismissed: true,
    });
    expect(w.inputs.at(-1)).toMatchObject({
      exploration: 0.6,
      peerReviewedOnly: true,
      showDismissed: true,
    });
  });

  it("reads the starting values when a host calls it with none", async () => {
    const w = world();
    w.opened();
    await w.host.build();
    await w.host.find();
    expect(w.inputs.at(-1)).toMatchObject({
      exploration: 0.25,
      peerReviewedOnly: false,
      showDismissed: false,
    });
  });

  it("Retry repeats the values of the run that failed", async () => {
    let fail = true;
    const w = world((input) => {
      if (input.mode === "profile-only") return profileEnding();
      return fail ? failedEnding() : rowsEnding([rowOf(1)]);
    });
    w.opened();
    await w.host.build();
    await w.host.find({
      slider: 80,
      peerReviewedOnly: true,
      showDismissed: true,
    });
    fail = false;
    await w.host.retry();
    expect(w.inputs.at(-1)).toMatchObject({
      exploration: 0.8,
      peerReviewedOnly: true,
      showDismissed: true,
    });
  });

  it.each([
    ["no-store", "research-helper-search-related-similarity-no-store"],
    ["no-vectors", "research-helper-search-recommend-similarity-no-vectors"],
    ["fetch-failed", "research-helper-search-related-similarity-fetch-failed"],
  ])("says %s as a warning line", async (notice, id) => {
    const w = await foundWith(
      rowsEnding([rowOf(1)], { similarity: { space: "lexical", notice } }),
    );
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([id]);
  });

  it("says once what the word space's rows do not, only when a row had novelty", async () => {
    const withReasons = (
      n: number,
      reasons: readonly unknown[],
      similaritySpace: string,
    ) =>
      rowOf(n, {
        recommendation: {
          ...rowOf(n).recommendation,
          reasons,
          similaritySpace,
        },
      } as unknown as Partial<RecommendationRow>);
    const onWords = { similarity: { space: "lexical" } };
    const withNovelty = await foundWith(
      rowsEnding(
        [
          withReasons(1, [{ id: "recency" }], "lexical"),
          withReasons(2, [{ id: "novelty" }], "lexical"),
        ],
        onWords,
      ),
    );
    expect(withNovelty.last().recommend.listNote?.id).toBe(`${P}novelty-note`);
    void withNovelty.host.find();
    expect(withNovelty.last().recommend.listNote).toBeUndefined();
    const without = await foundWith(
      rowsEnding([withReasons(1, [{ id: "recency" }], "lexical")], onWords),
    );
    expect(without.last().recommend.listNote).toBeUndefined();
    const onSpecter = await foundWith(
      rowsEnding([withReasons(1, [{ id: "novelty" }], "specter_v2")]),
    );
    expect(onSpecter.last().recommend.listNote).toBeUndefined();
  });

  it("takes a row's badge, reasons and group from the run", async () => {
    const w = await foundWith(
      rowsEnding(
        [
          rowOf(1, {
            preprint: true,
            recommendation: {
              ...rowOf(1).recommendation,
              topicIndex: 1,
            },
          } as unknown as Partial<RecommendationRow>),
        ],
        {
          profile: profileOf({
            centroids: [[1], [2]],
          } as unknown as Partial<CollectionProfile>),
        },
      ),
    );
    const [row] = w.last().records ?? [];
    expect(row).toMatchObject({
      preprint: true,
      reasons: [{ id: `${P}reason-similarity` }],
      group: { key: "1", ref: { id: `${P}group-numbered` } },
    });
  });

  it("marks the rows a run asked for as dismissed, and says that it asked", async () => {
    const w = world((input) =>
      input.mode === "profile-only"
        ? profileEnding()
        : rowsEnding([
            rowOf(1),
            rowOf(2, { dismissed: true, checkedByDefault: false }),
          ]),
    );
    w.opened();
    await w.host.build();
    await w.host.find({
      slider: 25,
      peerReviewedOnly: false,
      showDismissed: true,
    });
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-2"]);
    expect(w.last().recommend.dismissedAsked).toBe(true);
  });

  it("says the run did not ask, when it did not", async () => {
    const w = await foundWith(rowsEnding([rowOf(1)]));
    expect(w.last().recommend.dismissedAsked).toBe(false);
  });

  it("clears what it holds of a list when a new run starts, and when the window goes", async () => {
    let answerRun: (output: RecommendOutput) => void = () => undefined;
    const w = world((input) =>
      input.mode === "profile-only"
        ? profileEnding()
        : new Promise<RecommendOutput>((resolve) => {
            answerRun = resolve;
          }),
    );
    w.opened();
    await w.host.build();
    const first = w.host.find({
      slider: 25,
      peerReviewedOnly: false,
      showDismissed: true,
    });
    await vi.waitFor(() => {
      expect(w.inputs).toHaveLength(2);
    });
    answerRun(rowsEnding([rowOf(1, { dismissed: true })]));
    await first;
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-1"]);
    const second = w.host.find();
    expect(w.last().recommend.dismissedKeys).toStrictEqual([]);
    expect(w.last().recommend.dismissedAsked).toBe(false);
    expect(w.last().recommend.listNote).toBeUndefined();
    await vi.waitFor(() => {
      expect(w.inputs).toHaveLength(3);
    });
    answerRun(rowsEnding([rowOf(1, { dismissed: true })]));
    await second;
    w.host.connect(w.view);
    expect(w.last().recommend.dismissedKeys).toStrictEqual([]);
    await w.host.dismiss("key-1");
    expect(w.reject).not.toHaveBeenCalled();
  });
});

describe("P5-T27: Not interested", () => {
  const P = "research-helper-search-recommend-";

  async function listed(options: Parameters<typeof world>[1] = {}, extra = {}) {
    const w = world(
      (input) =>
        input.mode === "profile-only"
          ? profileEnding()
          : rowsEnding([rowOf(1), rowOf(2)], extra),
      options,
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    return w;
  }

  it("rejects the row against its own profile, and says so", async () => {
    const w = await listed();
    const revision = w.last().recordsRevision;
    await w.host.dismiss("key-2");
    expect(w.reject).toHaveBeenCalledExactlyOnceWith(
      collectionProfileId(LIBRARY_ID, COLLECTION_KEY),
      "key-2",
    );
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-2"]);
    expect(w.last().status?.id).toBe(`${P}dismissed-status`);
    // No new list: the document must keep every other row's tick.
    expect(w.last().recordsRevision).toBe(revision);
  });

  it("says only that it stays out when no service reads a negative", async () => {
    const w = await listed({}, { keyNotice: true });
    await w.host.dismiss("key-1");
    expect(w.last().status?.id).toBe(`${P}dismissed-status-no-key`);
  });

  it("gives the document a new array, so it can tell", async () => {
    const w = await listed();
    const before = w.last().recommend.dismissedKeys;
    await w.host.dismiss("key-1");
    expect(w.last().recommend.dismissedKeys).not.toBe(before);
    await w.host.dismiss("key-2");
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-1", "key-2"]);
  });

  it("keeps the row and warns when no row was stored", async () => {
    const w = await listed({ reject: () => Promise.resolve(false) });
    await w.host.dismiss("key-1");
    expect(w.last().recommend.dismissedKeys).toStrictEqual([]);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      `${P}dismiss-failed`,
    ]);
  });

  it("keeps the row and warns on a storage error, logging only its code", async () => {
    const w = await listed({
      reject: () =>
        Promise.reject(
          new StorageError("rh-error-unknown", {
            detail: "a path C:/Users/someone/zotero.sqlite",
          }),
        ),
    });
    await w.host.dismiss("key-1");
    expect(w.last().recommend.dismissedKeys).toStrictEqual([]);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      `${P}dismiss-failed`,
    ]);
    expect(JSON.stringify(w.warn.mock.calls)).not.toContain("someone");
    expect(w.warn).toHaveBeenCalledWith("a dismissal could not be stored", {
      code: expect.stringMatching(/^[A-Z_]+$/) as string,
    });
  });

  it("logs a failure that is not this plugin's own as unknown", async () => {
    const w = await listed({
      reject: () => Promise.reject(new Error("a secret detail")),
    });
    await w.host.dismiss("key-1");
    expect(w.warn).toHaveBeenCalledWith("a dismissal could not be stored", {
      code: "UNKNOWN",
    });
  });

  it("clears a warning it raised once a later one succeeds", async () => {
    let answer = false;
    const w = await listed({ reject: () => Promise.resolve(answer) });
    await w.host.dismiss("key-1");
    answer = true;
    await w.host.dismiss("key-1");
    expect(w.last().warnings).toStrictEqual([]);
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-1"]);
  });

  it("sends one call for two clicks, and none for a row already dismissed", async () => {
    let answer: (stored: boolean) => void = () => undefined;
    const w = await listed({
      reject: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    const first = w.host.dismiss("key-1");
    await w.host.dismiss("key-1");
    expect(w.reject).toHaveBeenCalledTimes(1);
    answer(true);
    await first;
    await w.host.dismiss("key-1");
    expect(w.reject).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a key the list does not have, or with no list", async () => {
    const w = await listed();
    await w.host.dismiss("key-9");
    expect(w.reject).not.toHaveBeenCalled();
    expect(w.last().warnings).toStrictEqual([]);
    const fresh = world();
    fresh.opened();
    await fresh.host.dismiss("key-1");
    expect(fresh.reject).not.toHaveBeenCalled();
  });

  it("is ignored during a run", async () => {
    let answerRun: (output: RecommendOutput) => void = () => undefined;
    let runs = 0;
    const w = world((input) => {
      if (input.mode === "profile-only") return profileEnding();
      runs += 1;
      return runs === 1
        ? rowsEnding([rowOf(1)])
        : new Promise<RecommendOutput>((resolve) => {
            answerRun = resolve;
          });
    });
    w.opened();
    await w.host.build();
    await w.host.find();
    const second = w.host.find();
    await w.host.dismiss("key-1");
    expect(w.reject).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(runs).toBe(2);
    });
    answerRun(rowsEnding([]));
    await second;
  });

  it("draws nothing when a new list has arrived by the time the store answers", async () => {
    let answer: (stored: boolean) => void = () => undefined;
    const w = await listed({
      reject: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    const dismissal = w.host.dismiss("key-1");
    await w.host.find();
    answer(true);
    await dismissal;
    expect(w.last().recommend.dismissedKeys).toStrictEqual([]);
    expect(w.last().status?.id).not.toBe(`${P}dismissed-status`);
  });

  it("has no list to act on after a run that failed", async () => {
    let fail = false;
    const w = world((input) => {
      if (input.mode === "profile-only") return profileEnding();
      return fail ? failedEnding() : rowsEnding([rowOf(1)]);
    });
    w.opened();
    await w.host.build();
    await w.host.find();
    fail = true;
    await w.host.find();
    await w.host.dismiss("key-1");
    expect(w.reject).not.toHaveBeenCalled();
  });

  it("is ignored during an import", async () => {
    let answer: (output: SearchImportOutput) => void = () => undefined;
    const w = await listed({
      importOutput: () =>
        new Promise<SearchImportOutput>((resolve) => {
          answer = resolve;
        }),
    });
    const going = w.host.importRows({
      keys: ["key-1"],
      collectionID: "9",
      parentIsSource: false,
    });
    await w.host.dismiss("key-2");
    expect(w.reject).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(w.importRun).toHaveBeenCalled();
    });
    answer(wroteOutput());
    await going;
  });

  it("leaves an import's line alone when the store answers during one", async () => {
    let stored: (value: boolean) => void = () => undefined;
    let wrote: (output: SearchImportOutput) => void = () => undefined;
    const w = await listed({
      reject: () =>
        new Promise<boolean>((resolve) => {
          stored = resolve;
        }),
      importOutput: () =>
        new Promise<SearchImportOutput>((resolve) => {
          wrote = resolve;
        }),
    });
    const dismissal = w.host.dismiss("key-2");
    const going = w.host.importRows({
      keys: ["key-1"],
      collectionID: "9",
      parentIsSource: false,
    });
    stored(true);
    await dismissal;
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-2"]);
    expect(w.last().status?.id).toBe("research-helper-search-status-importing");
    await vi.waitFor(() => {
      expect(w.importRun).toHaveBeenCalled();
    });
    wrote(wroteOutput());
    await going;
  });

  it("keeps the run's own warnings beside a dismissal's", async () => {
    const w = await listed(
      { reject: () => Promise.resolve(false) },
      { similarity: { space: "lexical", notice: "no-store" } },
    );
    await w.host.dismiss("key-1");
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-similarity-no-store",
      `${P}dismiss-failed`,
    ]);
  });

  it("writes nothing but the rejection: no second run, no import", async () => {
    const w = await listed();
    const runs = w.execute.mock.calls.length;
    await w.host.dismiss("key-1");
    expect(w.execute).toHaveBeenCalledTimes(runs);
    expect(w.importRun).not.toHaveBeenCalled();
  });
});

describe("P5-T27: the import", () => {
  const P = "research-helper-search-recommend-";
  const DATED = "new:mRNA LNP — recommended 2026-11-05";

  async function listed(
    rows: readonly RecommendationRow[] = [rowOf(1), rowOf(2), rowOf(3)],
    options: Parameters<typeof world>[1] = {},
  ) {
    const w = world(
      (input) =>
        input.mode === "profile-only" ? profileEnding() : rowsEnding(rows),
      options,
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    return w;
  }
  const inputOf = (w: ReturnType<typeof world>) => {
    const input = w.importRun.mock.calls.at(-1)?.[0];
    if (input === undefined) throw new Error("no import ran");
    return input;
  };
  const DEFAULT_REQUEST = {
    keys: ["key-1"],
    collectionID: DATED,
    parentIsSource: true,
  };

  it("writes the ticked rows only, as the preview path's works and records", async () => {
    const w = await listed();
    await w.host.importRows({ ...DEFAULT_REQUEST, keys: ["key-1", "key-3"] });
    const input = inputOf(w);
    expect((input.works ?? []).map((work) => work.workKey)).toStrictEqual([
      "key-1",
      "key-3",
    ]);
    expect(
      (input.records ?? []).map((record) => record.work.title),
    ).toStrictEqual(["Paper 1", "Paper 3"]);
    expect(input).toMatchObject({
      query: "",
      sourceIds: [],
      dateFilter: "none",
    });
    expect(input.limit).toBe(PREFS.maxResults.min);
  });

  it("nests the dated default under the source, in the source's library", async () => {
    const w = await listed();
    await w.host.importRows(DEFAULT_REQUEST);
    expect(inputOf(w).target).toStrictEqual({
      collectionName: "mRNA LNP — recommended 2026-11-05",
      parentCollectionId: COLLECTION_ID,
      libraryId: LIBRARY_ID,
      duplicatePolicy: "link-existing",
    });
  });

  it("does not nest any other choice", async () => {
    const w = await listed();
    await w.host.importRows({
      keys: ["key-1"],
      collectionID: "9",
      parentIsSource: false,
    });
    expect(inputOf(w).target).toStrictEqual({
      collectionName: "Elsewhere",
      libraryId: LIBRARY_ID,
      duplicatePolicy: "link-existing",
    });
  });

  it("links a row owned through its title to the item it matched", async () => {
    const w = await listed([
      rowOf(1, { inLibrary: true, existingItemID: 41 }),
      rowOf(2),
    ]);
    await w.host.importRows({ ...DEFAULT_REQUEST, keys: ["key-1", "key-2"] });
    expect(inputOf(w).target?.existingItemIDs).toStrictEqual(
      new Map([["key-1", 41]]),
    );
  });

  it("writes one record per work, whatever else a row merged", async () => {
    const [record] = rowOf(1).records;
    if (record === undefined) throw new Error("no record");
    const w = await listed([rowOf(1, { records: [record, record] }), rowOf(2)]);
    await w.host.importRows({ ...DEFAULT_REQUEST, keys: ["key-1", "key-2"] });
    expect(inputOf(w).records).toHaveLength(2);
    expect(inputOf(w).works).toHaveLength(2);
  });

  it("keeps the run's warnings beside an import that wrote nothing", async () => {
    const w = world(
      (input) =>
        input.mode === "profile-only"
          ? profileEnding()
          : rowsEnding([rowOf(1)], {
              similarity: { space: "lexical", notice: "no-store" },
            }),
      {
        importOutput: () =>
          Promise.resolve({
            outcome: "cancelled",
          } as unknown as SearchImportOutput),
      },
    );
    w.opened();
    await w.host.build();
    await w.host.find();
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      "research-helper-search-related-similarity-no-store",
    ]);
  });

  it("drops a row with no record, rather than mispairing the two lists", async () => {
    const w = await listed([rowOf(1, { records: [] }), rowOf(2)]);
    await w.host.importRows({ ...DEFAULT_REQUEST, keys: ["key-1", "key-2"] });
    expect((inputOf(w).works ?? []).map((work) => work.workKey)).toStrictEqual([
      "key-2",
    ]);
    expect(inputOf(w).records).toHaveLength(1);
    expect(w.warn).toHaveBeenCalledWith(
      "a recommend import named rows the run does not have",
      { asked: 2, kept: 1 },
    );
  });

  it("opens a job of its own, on no collection, and shows the summary at its end", async () => {
    const w = await listed();
    const revision = w.last().recordsRevision;
    w.openOptions.length = 0;
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.openOptions[0]).toMatchObject({
      pipelineId: "searchImport",
      openOn: "completion",
    });
    expect(w.openOptions[0]).not.toHaveProperty("collection");
    expect(w.last().status?.id).toBe("research-helper-import-summary");
    expect(w.last().running).toBe(false);
    expect(w.last().recordsRevision).toBe(revision);
    expect(w.done).toHaveBeenLastCalledWith("succeeded", undefined);
    expect(w.dispose).toHaveBeenCalled();
  });

  it("says it is writing while it writes, and follows the job's progress", async () => {
    let answer: (output: SearchImportOutput) => void = () => undefined;
    const w = await listed(undefined, {
      importOutput: () =>
        new Promise<SearchImportOutput>((resolve) => {
          answer = resolve;
        }),
    });
    const going = w.host.importRows({
      ...DEFAULT_REQUEST,
      keys: ["key-1", "key-2"],
    });
    expect(w.last().running).toBe(true);
    expect(w.last().status).toStrictEqual({
      id: "research-helper-search-status-importing",
      args: { done: 0, total: 2 },
    });
    await vi.waitFor(() => {
      expect(w.importRun).toHaveBeenCalled();
    });
    w.emit({
      completed: 1,
      total: 2,
      fraction: 0.5,
    } as unknown as ProgressSnapshot);
    expect(w.last().progressPercent).toBe(50);
    expect(w.last().status).toStrictEqual({
      id: "research-helper-search-status-importing",
      args: { done: 1, total: 2 },
    });
    answer(wroteOutput());
    await going;
    expect(w.last().running).toBe(false);
  });

  it("starts one write for two clicks", async () => {
    let answer: (output: SearchImportOutput) => void = () => undefined;
    const w = await listed(undefined, {
      importOutput: () =>
        new Promise<SearchImportOutput>((resolve) => {
          answer = resolve;
        }),
    });
    const going = w.host.importRows(DEFAULT_REQUEST);
    await w.host.importRows(DEFAULT_REQUEST);
    await vi.waitFor(() => {
      expect(w.importRun).toHaveBeenCalledTimes(1);
    });
    answer(wroteOutput());
    await going;
    expect(w.importRun).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no key it knows", { keys: ["key-9"], collectionID: DATED }],
    ["no keys", { keys: [], collectionID: DATED }],
    ["no name", { keys: ["key-1"], collectionID: "new:  " }],
    ["bare new", { keys: ["key-1"], collectionID: "new" }],
    [
      "a collection gone from the list",
      { keys: ["key-1"], collectionID: "12" },
    ],
  ])("writes nothing for %s", async (_name, request) => {
    const w = await listed();
    const jobs = w.openJob.mock.calls.length;
    await w.host.importRows({ ...request, parentIsSource: false });
    expect(w.importRun).not.toHaveBeenCalled();
    expect(w.openJob).toHaveBeenCalledTimes(jobs);
  });

  it("writes nothing with no list", async () => {
    const w = world();
    w.opened();
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.importRun).not.toHaveBeenCalled();
  });

  it("refuses when the source collection has gone, and says so", async () => {
    let gone = false;
    const w = await listed(undefined, { collectionGone: () => gone });
    gone = true;
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.importRun).not.toHaveBeenCalled();
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      `${P}collection-gone`,
    ]);
  });

  it("shows a failed import's headline with this mode's fallback", async () => {
    const w = await listed(undefined, {
      importOutput: () =>
        Promise.resolve({
          outcome: "failed",
          error: {
            code: "UNKNOWN",
            messageKey: "rh-error-unknown",
            retryable: false,
          },
        } as unknown as SearchImportOutput),
    });
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.last().running).toBe(false);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      `${P}state-failed`,
    ]);
    expect(w.done).toHaveBeenLastCalledWith("failed", undefined);
  });

  it("reports a partial import as a job that succeeded", async () => {
    const w = await listed(undefined, {
      importOutput: () => Promise.resolve(wroteOutput({ outcome: "partial" })),
    });
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.done).toHaveBeenLastCalledWith("succeeded", undefined);
  });

  it("says a cancelled import with nothing written", async () => {
    const w = await listed(undefined, {
      importOutput: () =>
        Promise.resolve({
          outcome: "cancelled",
        } as unknown as SearchImportOutput),
    });
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.last().status).toStrictEqual({
      id: "rh-error-cancelled",
      args: { imported: 0 },
    });
    expect(w.done).toHaveBeenLastCalledWith("cancelled", undefined);
  });

  it("draws a defect and rethrows when the import throws, and can import again", async () => {
    let boom = true;
    const w = await listed(undefined, {
      importOutput: () =>
        boom
          ? Promise.reject(new Error("a defect"))
          : Promise.resolve(wroteOutput()),
    });
    await expect(w.host.importRows(DEFAULT_REQUEST)).rejects.toThrow(
      "a defect",
    );
    expect(w.last().running).toBe(false);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      `${P}state-failed`,
    ]);
    boom = false;
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.importRun).toHaveBeenCalledTimes(2);
  });

  it("draws a defect and rethrows when its job cannot open", async () => {
    const w = await listed();
    w.openJob.mockImplementationOnce(() => Promise.reject(new Error("no job")));
    await expect(w.host.importRows(DEFAULT_REQUEST)).rejects.toThrow("no job");
    expect(w.importRun).not.toHaveBeenCalled();
    expect(w.last().running).toBe(false);
    expect(w.last().warnings.map((line) => line.id)).toStrictEqual([
      `${P}state-failed`,
    ]);
  });

  it("records nothing about the import: no rejection and no run", async () => {
    const w = await listed();
    const runs = w.execute.mock.calls.length;
    await w.host.importRows(DEFAULT_REQUEST);
    expect(w.reject).not.toHaveBeenCalled();
    expect(w.execute).toHaveBeenCalledTimes(runs);
  });

  it("still dismisses after an import", async () => {
    const w = await listed();
    await w.host.importRows(DEFAULT_REQUEST);
    await w.host.dismiss("key-2");
    expect(w.reject).toHaveBeenCalledTimes(1);
    expect(w.last().recommend.dismissedKeys).toStrictEqual(["key-2"]);
  });
});

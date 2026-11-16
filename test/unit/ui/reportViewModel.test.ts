/**
 * `P4-T20` — the report window's view model (`src/ui/viewModels/reportViewModel.ts`):
 * every stage row, cancel, each delivery button's enabled state, the preview's
 * draft-then-final path, the confirmation and the named-group question. Pure:
 * no window, no Zotero, no network.
 */

import { describe, expect, it, vi } from "vitest";

import type { EgressDisclosure } from "../../../src/pipeline/shared/egressDisclosure";
import type { ReportRunEstimate } from "../../../src/pipeline/shared/estimate";
import {
  TREND_REPORT_STAGE_KEYS,
  type TrendReportConfirmRequest,
  type TrendReportRunView,
  type TrendReportStageKey,
} from "../../../src/pipeline/trendReport/trendReportPipeline";
import {
  L10N_AUDIO_TIER_REFUSED,
  L10N_MENU_COLLECTION_AUDIO_REPORT,
  L10N_MENU_COLLECTION_REPORT,
  L10N_MENU_COLLECTION_RERUN,
  L10N_MENU_COLLECTION_SEARCH_IMPORT,
  REPORT_WINDOW_MESSAGE_IDS,
} from "../../../src/i18n/keys";
import {
  collectionMenuOptions,
  type SearchMenuCommands,
} from "../../../src/ui/menus/registerMenus";
import type {
  AudioRefusalReason,
  AudioReportRunView,
} from "../../../src/pipeline/audioReport/audioReportPipeline";
import {
  REPORT_WINDOW_AUDIO_L10N,
  REPORT_WINDOW_L10N,
  type ReportWindowSink,
} from "../../../src/ui/panes/reportWindow";
import {
  AUDIO_SECTION_L10N,
  IDLE_AUDIO_SECTION,
  audioScriptSourceLanguage,
  buildAudioSectionModel,
  initialAudioVoice,
  reduceAudioSection,
  windowAudioModel,
  type AudioSectionEvent,
  type AudioSectionReport,
  type AudioSectionState,
  type AudioVoiceOption,
  IDLE_REPORT_RUN,
  REPORT_ROW_STAGES,
  REPORT_RUN_L10N,
  buildReportRunModel,
  confirmReportRun,
  askOnce,
  groupSaveQuestion,
  interfaceReportLanguage,
  isMainWindowLine,
  pausedJobQuestion,
  reduceReportRun,
  reportPauseQuestion,
  resolveReportLanguage,
  settleReportNote,
  windowRunModel,
  type ReportConfirmDeps,
  type ReportModelExtras,
  type ReportRowKey,
  type ReportRunEvent,
  type ReportRunState,
} from "../../../src/ui/viewModels/reportViewModel";

const EXTRAS: ReportModelExtras = {
  canStart: true,
  saveNoteSetting: true,
  libraryEditable: true,
  locale: "en-US",
};

function view(
  stage: TrendReportRunView["stage"],
  fields: Partial<TrendReportRunView> = {},
): TrendReportRunView {
  return {
    stage,
    collectionName: "Synthetic",
    total: 30,
    papers: 28,
    summaries: { toMake: 10, made: 4, cached: 3, failed: 1 },
    themes: { done: 2, total: 5 },
    passes: 0,
    ...fields,
  };
}

function run(...events: ReportRunEvent[]): ReportRunState {
  return events.reduce(reduceReportRun, IDLE_REPORT_RUN);
}

const started: ReportRunEvent = { kind: "started" };
const at = (stage: TrendReportRunView["stage"]): ReportRunEvent => ({
  kind: "view",
  view: view(stage),
});
const delta = (deltaText: string, generation = 1): ReportRunEvent => ({
  kind: "draft",
  delta: { generation, deltaText },
});

function rows(state: ReportRunState): Record<ReportRowKey, string> {
  const model = buildReportRunModel(state, EXTRAS);
  return Object.fromEntries(
    model.rows.map((row) => [row.key, row.status]),
  ) as Record<ReportRowKey, string>;
}

describe("P4-T20 — every stage row", () => {
  it("covers each of docs/07 §12.4's stages exactly once, in run order", () => {
    const covered = Object.values(REPORT_ROW_STAGES).flat();
    expect(covered).toEqual([...TREND_REPORT_STAGE_KEYS]);
  });

  const expected: readonly (readonly [
    TrendReportStageKey,
    Record<ReportRowKey, string>,
  ])[] = [
    [
      "Screening",
      {
        reading: "active",
        summaries: "pending",
        themes: "pending",
        writing: "pending",
        review: "pending",
        finishing: "pending",
      },
    ],
    [
      "AwaitingConfirm",
      {
        reading: "active",
        summaries: "pending",
        themes: "pending",
        writing: "pending",
        review: "pending",
        finishing: "pending",
      },
    ],
    [
      "EnsuringSummaries",
      {
        reading: "done",
        summaries: "active",
        themes: "pending",
        writing: "pending",
        review: "pending",
        finishing: "pending",
      },
    ],
    [
      "Clustering",
      {
        reading: "done",
        summaries: "done",
        themes: "active",
        writing: "pending",
        review: "pending",
        finishing: "pending",
      },
    ],
    [
      "Composing",
      {
        reading: "done",
        summaries: "done",
        themes: "done",
        writing: "active",
        review: "pending",
        finishing: "pending",
      },
    ],
    [
      "Critiquing",
      {
        reading: "done",
        summaries: "done",
        themes: "done",
        writing: "done",
        review: "active",
        finishing: "pending",
      },
    ],
    [
      "Saving",
      {
        reading: "done",
        summaries: "done",
        themes: "done",
        writing: "done",
        review: "done",
        finishing: "active",
      },
    ],
  ];
  for (const [stage, statuses] of expected) {
    it(`marks the rows at ${stage}`, () => {
      expect(rows(run(started, at(stage)))).toEqual(statuses);
    });
  }

  it("carries the counts: summaries cached and new, themes done of K, the critique round", () => {
    const model = buildReportRunModel(
      run(started, at("Critiquing"), {
        kind: "revision",
        signal: { kind: "rewrite-started", round: 2 },
      }),
      EXTRAS,
    );
    const line = (key: ReportRowKey) =>
      model.rows.find((row) => row.key === key)?.line;
    expect(line("summaries")).toEqual({
      id: REPORT_RUN_L10N.rowSummaries,
      args: { made: 4, cached: 3, toMake: 10, failed: 1 },
    });
    expect(line("themes")).toEqual({
      id: REPORT_RUN_L10N.rowThemes,
      args: { done: 2, total: 5 },
    });
    expect(line("review")).toEqual({
      id: REPORT_RUN_L10N.rowReview,
      args: { round: 2 },
    });
    expect(line("reading")).toEqual({ id: REPORT_RUN_L10N.rowReading });
    expect(line("writing")).toEqual({ id: REPORT_RUN_L10N.rowWriting });
    expect(line("finishing")).toEqual({ id: REPORT_RUN_L10N.rowFinishing });
  });

  it("a pause keeps its stage's row active and says it waits", () => {
    const state = run(started, at("Analysing"), at("waiting"));
    expect(rows(state).themes).toBe("active");
    expect(buildReportRunModel(state, EXTRAS).stage).toEqual({
      id: REPORT_RUN_L10N.stage,
      args: { stage: "waiting" },
    });
  });

  it("names a stage token the bundle's selector has for every stage", () => {
    for (const stage of TREND_REPORT_STAGE_KEYS) {
      const line = buildReportRunModel(run(started, at(stage)), EXTRAS).stage;
      expect(line?.id).toBe(REPORT_RUN_L10N.stage);
      expect([
        "reading",
        "confirming",
        "summaries",
        "themes",
        "writing",
        "reviewing",
        "finishing",
      ]).toContain(line?.args?.["stage"]);
    }
  });

  it("every row is done once the report is ready, and shows the spend", () => {
    const state = run(
      started,
      at("Saving"),
      { kind: "spend", usd: 0.25 },
      { kind: "finished", outcome: "succeeded", markdown: "# R" },
    );
    expect(new Set(Object.values(rows(state)))).toEqual(new Set(["done"]));
    expect(buildReportRunModel(state, EXTRAS).spend).toEqual({
      id: REPORT_RUN_L10N.spend,
      args: { cost: "$0.25" },
    });
  });
});

describe("P4-T20 — the preview: raw draft, then the final text (item 286; Done when 2)", () => {
  it("appends deltas labelled draft; aria-live waits for the end", () => {
    const model = buildReportRunModel(
      run(started, at("Composing"), delta("# Rep"), delta("ort")),
      EXTRAS,
    );
    expect(model.preview.text).toBe("# Report");
    expect(model.preview.label).toEqual({
      id: REPORT_RUN_L10N.previewLabel,
      args: { state: "draft" },
    });
    expect(model.preview.final).toBe(false);
  });

  it("a second generation replaces the first", () => {
    const state = run(started, delta("first"), delta("second", 2));
    expect(state.preview.text).toBe("second");
  });

  it("a rewrite starts the text again, though its generation is 1 again (item 314(c))", () => {
    const state = run(
      started,
      delta("first draft"),
      { kind: "revision", signal: { kind: "rewrite-started", round: 1 } },
      delta("rewr"),
      delta("ite"),
    );
    expect(state.preview.text).toBe("rewrite");
    expect(state.preview.state).toBe("draft");
    // The old draft is gone before the rewrite's first delta arrives.
    expect(
      run(started, delta("first draft"), {
        kind: "revision",
        signal: { kind: "rewrite-started", round: 1 },
      }).preview.text,
    ).toBe("");
  });

  it("a rewrite that could not be applied puts the kept draft back", () => {
    const state = run(
      started,
      delta("kept"),
      { kind: "revision", signal: { kind: "rewrite-started", round: 1 } },
      delta("bad rewrite"),
      {
        kind: "revision",
        signal: { kind: "rewrite-not-applied", round: 1, markdown: "kept" },
      },
    );
    expect(state.preview.text).toBe("kept");
  });

  it("when the critique stage ends the text is final, and the stored report replaces it once", () => {
    const composed = run(started, at("Critiquing"), delta("body"));
    expect(composed.preview.state).toBe("draft");
    const ended = reduceReportRun(composed, at("Scaffolding"));
    expect(ended.preview.state).toBe("final");
    expect(ended.preview.text).toBe("body");
    const model = buildReportRunModel(ended, EXTRAS);
    expect(model.preview.final).toBe(true);
    expect(model.preview.label).toEqual({
      id: REPORT_RUN_L10N.previewLabel,
      args: { state: "final" },
    });
    const saved = reduceReportRun(ended, {
      kind: "finished",
      outcome: "succeeded",
      markdown: "# Title\n\nbody\n\n## Appendix",
    });
    expect(saved.preview.text).toBe("# Title\n\nbody\n\n## Appendix");
    // A late delta cannot touch the final text.
    expect(reduceReportRun(saved, delta("late")).preview.text).toBe(
      saved.preview.text,
    );
  });

  it("shows no label before any text and none for a cached report until it is saved", () => {
    expect(
      buildReportRunModel(run(started, at("Scaffolding")), EXTRAS).preview
        .label,
    ).toBeUndefined();
  });
});

describe("P4-T20 — cancel, stops and failures say discarded honestly (step 3)", () => {
  for (const outcome of ["cancelled", "stopped", "failed"] as const) {
    it(`${outcome}: the draft is discarded and nothing can be delivered`, () => {
      const state = run(started, at("Composing"), delta("half"), {
        kind: "finished",
        outcome,
      });
      const model = buildReportRunModel(state, EXTRAS);
      expect(model.preview.text).toBe("");
      expect(model.preview.label).toEqual({
        id: REPORT_RUN_L10N.previewLabel,
        args: { state: "discarded" },
      });
      expect(model.buttons).toEqual({
        generate: true,
        cancel: false,
        saveNote: false,
        export: false,
        copy: false,
      });
      expect(model.running).toBe(false);
    });
  }

  it("a stop shows its reason from the main bundle with its arguments, and no generic outcome", () => {
    const model = buildReportRunModel(
      run(started, {
        kind: "finished",
        outcome: "stopped",
        stop: {
          messageId: "research-helper-report-stopped-papers-failed",
          args: { failed: 11, total: 30 },
        },
      }),
      EXTRAS,
    );
    expect(model.outcome).toBeUndefined();
    expect(model.stop).toEqual({
      bundle: "main",
      id: "research-helper-report-stopped-papers-failed",
      args: { failed: 11, total: 30 },
    });
    expect(isMainWindowLine(model.stop)).toBe(true);
    // The window links only its own bundle: the host's text reaches it.
    const out = windowRunModel(model, () => "Stopped: 11 of 30");
    expect(out.stop).toEqual({ text: "Stopped: 11 of 30" });
    expect(windowRunModel(model, () => undefined).stop).toBeUndefined();
    expect(out.rows).toBe(model.rows);
  });

  it("a both run that saved English alone shows the outcome and why Korean was not written (P4-T21; item 334(d))", () => {
    const model = buildReportRunModel(
      run(started, {
        kind: "finished",
        outcome: "succeeded",
        markdown: "# English",
        stop: {
          messageId: "research-helper-report-stopped-korean",
          args: { reason: "structure" },
        },
      }),
      EXTRAS,
    );
    expect(model.outcome).toEqual({
      id: REPORT_RUN_L10N.outcome,
      args: { outcome: "succeeded" },
    });
    expect(model.stop).toEqual({
      bundle: "main",
      id: "research-helper-report-stopped-korean",
      args: { reason: "structure" },
    });
    expect(model.preview.text).toBe("# English");
    expect(model.buttons.export).toBe(true);
    expect(model.buttons.copy).toBe(true);
    expect(model.reportChoice).toBeUndefined();
  });

  it("the cancelled outcome names the token the bundle selects on", () => {
    const model = buildReportRunModel(
      run(started, { kind: "finished", outcome: "cancelled" }),
      EXTRAS,
    );
    expect(model.outcome).toEqual({
      id: REPORT_RUN_L10N.outcome,
      args: { outcome: "cancelled" },
    });
  });

  it("declining keeps whatever was shown and sends nothing", () => {
    const state = run(started, { kind: "finished", outcome: "declined" });
    expect(state.preview.state).toBe("none");
    expect(buildReportRunModel(state, EXTRAS).buttons.generate).toBe(true);
  });
});

describe("P4-T20 — each delivery button's enabled state (step 4)", () => {
  const ready = (note: ReportRunState["note"]): ReportRunState =>
    run(started, {
      kind: "finished",
      outcome: "succeeded",
      markdown: "# R",
      note,
    });

  it("before a run: Generate only when the host says it can start", () => {
    expect(buildReportRunModel(IDLE_REPORT_RUN, EXTRAS).buttons).toEqual({
      generate: true,
      cancel: false,
      saveNote: false,
      export: false,
      copy: false,
    });
    expect(
      buildReportRunModel(IDLE_REPORT_RUN, { ...EXTRAS, canStart: false })
        .buttons.generate,
    ).toBe(false);
  });

  it("while running: Cancel only", () => {
    expect(buildReportRunModel(run(started), EXTRAS).buttons).toEqual({
      generate: false,
      cancel: true,
      saveNote: false,
      export: false,
      copy: false,
    });
  });

  it("a written note: Export and Copy, no second Save", () => {
    expect(buildReportRunModel(ready("written"), EXTRAS).buttons).toEqual({
      generate: true,
      cancel: false,
      saveNote: false,
      export: true,
      copy: true,
    });
  });

  for (const note of ["declined", "failed"] as const) {
    it(`note ${note}: Save as note is offered`, () => {
      expect(buildReportRunModel(ready(note), EXTRAS).buttons.saveNote).toBe(
        true,
      );
    });
    it(`note ${note}, read-only library: no Save as note`, () => {
      expect(
        buildReportRunModel(ready(note), {
          ...EXTRAS,
          libraryEditable: false,
        }).buttons.saveNote,
      ).toBe(false);
    });
    it(`note ${note}, report.saveNote off: no Save as note`, () => {
      expect(
        buildReportRunModel(ready(note), {
          ...EXTRAS,
          saveNoteSetting: false,
        }).buttons.saveNote,
      ).toBe(false);
    });
  }

  for (const note of ["export-only", "no-collection", "off"] as const) {
    it(`note ${note}: Export and Copy remain, no Save as note`, () => {
      const model = buildReportRunModel(ready(note), EXTRAS);
      expect(model.buttons).toMatchObject({
        saveNote: false,
        export: true,
        copy: true,
      });
      expect(model.note).toEqual({
        id: REPORT_RUN_L10N.note,
        args: { state: note },
      });
    });
  }

  it("a paused job holds Generate until it is answered", () => {
    const state = run({ kind: "paused-job", reason: "budget-stop" });
    expect(buildReportRunModel(state, EXTRAS).buttons.generate).toBe(false);
    expect(buildReportRunModel(state, EXTRAS).stage).toEqual({
      id: REPORT_RUN_L10N.stage,
      args: { stage: "waiting" },
    });
    expect(
      buildReportRunModel(
        reduceReportRun(state, { kind: "paused-job", reason: undefined }),
        EXTRAS,
      ).buttons.generate,
    ).toBe(true);
  });

  it("the last of export and copy is what the line says", () => {
    const exported = reduceReportRun(ready("written"), {
      kind: "exported",
      outcome: "written",
    });
    expect(buildReportRunModel(exported, EXTRAS).delivery).toEqual({
      id: REPORT_RUN_L10N.exportOutcome,
      args: { outcome: "written" },
    });
    const copied = reduceReportRun(exported, { kind: "copied" });
    expect(buildReportRunModel(copied, EXTRAS).delivery).toEqual({
      id: REPORT_RUN_L10N.copied,
    });
    expect(
      buildReportRunModel(
        reduceReportRun(copied, { kind: "exported", outcome: "failed" }),
        EXTRAS,
      ).delivery,
    ).toEqual({
      id: REPORT_RUN_L10N.exportOutcome,
      args: { outcome: "failed" },
    });
  });
});

describe("P4-T20 — the named-group question (step 4; Done when 2)", () => {
  const required = {
    kind: "group-confirmation-required",
    libraryID: 7,
    groupName: "Lab group",
  } as const;

  function deps(answer: "resume" | "cancel") {
    return {
      ask: vi.fn(() => Promise.resolve(answer)),
      write: vi.fn(() =>
        Promise.resolve({ kind: "written", noteKey: "NOTEKEY1" } as const),
      ),
      store: vi.fn(() => Promise.resolve()),
    };
  }

  it("asks by name first; 'no' writes and stores nothing", async () => {
    const d = deps("cancel");
    expect(await settleReportNote(required, d)).toBe("declined");
    expect(d.ask).toHaveBeenCalledWith(groupSaveQuestion("Lab group"));
    expect(d.write).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
    expect(groupSaveQuestion("Lab group")).toEqual({
      line: { id: REPORT_RUN_L10N.groupQuestion, args: { group: "Lab group" } },
      yes: REPORT_RUN_L10N.groupSave,
      no: REPORT_RUN_L10N.groupSkip,
    });
  });

  it("'yes' writes with the answer naming that group and stores the key", async () => {
    const d = deps("resume");
    expect(await settleReportNote(required, d)).toBe("written");
    expect(d.write).toHaveBeenCalledWith({
      confirmed: true,
      libraryID: 7,
      groupName: "Lab group",
    });
    expect(d.store).toHaveBeenCalledWith("NOTEKEY1");
  });

  it("a note the run already wrote is not stored again", async () => {
    const d = deps("resume");
    expect(
      await settleReportNote({ kind: "written", noteKey: "NOTEKEY1" }, d),
    ).toBe("written");
    expect(d.write).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
  });

  it("Save as note writes now, and asks if the write needs the group's answer", async () => {
    const d = {
      ask: vi.fn(() => Promise.resolve("resume" as const)),
      write: vi
        .fn()
        .mockResolvedValueOnce(required)
        .mockResolvedValueOnce({ kind: "written", noteKey: "NOTEKEY2" }),
      store: vi.fn(() => Promise.resolve()),
    };
    expect(await settleReportNote(undefined, d)).toBe("written");
    expect(d.write).toHaveBeenNthCalledWith(1, undefined);
    expect(d.ask).toHaveBeenCalledTimes(1);
    expect(d.store).toHaveBeenCalledWith("NOTEKEY2");
  });

  it("passes export-only and no-collection on; a throw or a renamed group is a failure", async () => {
    const d = deps("resume");
    expect(await settleReportNote({ kind: "export-only" }, d)).toBe(
      "export-only",
    );
    expect(await settleReportNote({ kind: "no-collection" }, d)).toBe(
      "no-collection",
    );
    expect(
      await settleReportNote(undefined, {
        ...d,
        write: () => Promise.reject(new Error("disk")),
      }),
    ).toBe("failed");
    expect(
      await settleReportNote(required, {
        ...d,
        write: () => Promise.resolve(required),
      }),
    ).toBe("failed");
  });
});

describe("P4-T20 — the run's confirmation (P4-T16's dialog)", () => {
  const plan = { calls: 3, costUsd: 0.02 };
  const request = (ask: boolean): TrendReportConfirmRequest =>
    ({
      estimate: { selected: plan, abstractOnly: plan },
      disclosure: { providerId: "openrouter" } as unknown as EgressDisclosure,
      confirmation: ask
        ? { ask: true, reasons: ["first"] }
        : { ask: false, reasons: [] },
      ceilingSelected: undefined,
      ceilingDowngrade: undefined,
      collection: { libraryID: 1, collectionKey: "COLLKEY1" },
      session: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    }) as unknown as TrendReportConfirmRequest;

  function deps(
    outcome: Awaited<ReturnType<ReportConfirmDeps["openDialog"]>> | Error,
  ) {
    return {
      openDialog: vi.fn((): ReturnType<ReportConfirmDeps["openDialog"]> =>
        outcome instanceof Error
          ? Promise.reject(outcome)
          : Promise.resolve(outcome),
      ),
      settle: vi.fn(),
      confirmAboveCents: () => 100,
      fullTextAutoMaxPapers: () => 20,
      providerName: () => Promise.resolve("OpenRouter"),
      locale: () => "en-US",
    };
  }

  it("the report's own record says ask: the dialog opens and its answer carries dontAskAgain and the raise", async () => {
    const raise = { ceiling: "run", limitUsd: 2 } as const;
    const d = deps({
      kind: "run",
      plan: "abstract-only",
      raise,
      dontAskAgain: true,
    });
    const result = await confirmReportRun(d, request(true));
    expect(d.openDialog).toHaveBeenCalledTimes(1);
    expect(d.openDialog.mock.calls[0]).toBeDefined();
    expect(result.answer).toEqual({
      kind: "run",
      plan: "abstract-only",
      raise,
      dontAskAgain: true,
    });
    expect(d.settle).toHaveBeenCalledWith(
      request(true).disclosure,
      "confirmed",
    );
  });

  it("the record says don't ask and the cost is small: no dialog, and the number is shown", async () => {
    const d = deps({ kind: "cancelled" });
    const result = await confirmReportRun(d, request(false));
    expect(d.openDialog).not.toHaveBeenCalled();
    expect(result.answer).toEqual({
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: false,
    });
    expect(result.notice?.bundle).toBe("main");
    expect(result.notice?.args?.["calls"]).toBe(3);
  });

  it("money forces the dialog whatever the record says (item 274(b))", async () => {
    const d = deps({ kind: "cancelled" });
    const expensive = {
      ...request(false),
      estimate: {
        selected: { calls: 3, costUsd: 5 },
        abstractOnly: plan,
      } as unknown as ReportRunEstimate,
    };
    expect((await confirmReportRun(d, expensive)).answer).toEqual({
      kind: "cancelled",
    });
    expect(d.openDialog).toHaveBeenCalledTimes(1);
    expect(d.settle).toHaveBeenCalledWith(expensive.disclosure, "cancelled");
  });

  it("a dialog that cannot open runs nothing", async () => {
    const d = deps(new Error("no window"));
    expect((await confirmReportRun(d, request(true))).answer).toEqual({
      kind: "cancelled",
    });
  });
});

describe("P4-T20, P4-T21 — the language a run is written in", () => {
  it("resolves the selector: auto follows the UI; both passes through for the two-report run", () => {
    expect(resolveReportLanguage("en", "ko-KR")).toBe("en");
    expect(resolveReportLanguage("ko", "en-US")).toBe("ko");
    expect(resolveReportLanguage("auto", "ko-KR")).toBe("ko");
    expect(resolveReportLanguage("auto", "ko")).toBe("ko");
    expect(resolveReportLanguage("auto", "en-US")).toBe("en");
    expect(resolveReportLanguage("auto", "kok-IN")).toBe("en");
    expect(resolveReportLanguage("both", "ko-KR")).toBe("both");
    expect(resolveReportLanguage("both", "en-US")).toBe("both");
    expect(interfaceReportLanguage("ko-KR")).toBe("ko");
    expect(interfaceReportLanguage("en-US")).toBe("en");
  });
});

describe("P4-T21 — a two-report run in the window (docs/08 §6.2, §6.3's notes of 2026-11-02)", () => {
  const koDelta = (deltaText: string, generation = 1): ReportRunEvent => ({
    kind: "draft",
    delta: { generation, deltaText, language: "ko" },
  });
  const enDelta = (deltaText: string, generation = 1): ReportRunEvent => ({
    kind: "draft",
    delta: { generation, deltaText, language: "en" },
  });
  const finished = (note: "written" | "off" = "off"): ReportRunEvent => ({
    kind: "finished",
    outcome: "succeeded",
    markdown: "English report",
    note,
    reports: [
      { language: "en", text: "English report", note },
      { language: "ko", text: "한국어 보고서", note },
    ],
    shown: "en",
  });
  const model = (state: ReportRunState) => buildReportRunModel(state, EXTRAS);

  it("the preview restarts when the language changes, at the same generation", () => {
    const state = run(started, enDelta("Hello "), enDelta("world"));
    expect(state.preview.text).toBe("Hello world");
    const next = reduceReportRun(state, koDelta("안녕"));
    expect(next.preview.text).toBe("안녕");
    expect(next.preview.language).toBe("ko");
    expect(reduceReportRun(next, koDelta("하세요")).preview.text).toBe(
      "안녕하세요",
    );
  });

  it("a one-report run's preview carries no language", () => {
    expect(run(started, delta("x")).preview).toEqual({
      state: "draft",
      text: "x",
      generation: 1,
    });
  });

  it("going back to Composing for the next language clears the revision round and keeps the draft a draft", () => {
    const rewriting = run(started, at("Critiquing"), enDelta("x"), {
      kind: "revision",
      signal: { kind: "rewrite-started", round: 1 },
    });
    expect(rewriting.critiqueRound).toBe(1);
    const next = reduceReportRun(rewriting, at("Composing"));
    expect(next.critiqueRound).toBe(0);
    expect(next.preview.state).toBe("draft");
  });

  it("offers the selector only when the run gave two reports, and only after it ended", () => {
    expect(model(run(started, enDelta("x"))).reportChoice).toBeUndefined();
    const one = run(started, {
      kind: "finished",
      outcome: "succeeded",
      markdown: "Only one",
    });
    expect(model(one).reportChoice).toBeUndefined();
    expect(one.reports).toEqual([]);
    const single = run(started, {
      kind: "finished",
      outcome: "succeeded",
      reports: [{ language: "ko", text: "한국어", note: "off" }],
      shown: "ko",
    });
    expect(model(single).reportChoice).toBeUndefined();
    const two = run(started, finished());
    expect(model(two).reportChoice).toEqual({
      languages: ["en", "ko"],
      shown: "en",
    });
    // The window receives it as it is.
    expect(windowRunModel(model(two), () => undefined).reportChoice).toEqual(
      model(two).reportChoice,
    );
    // A new run clears it.
    expect(model(reduceReportRun(two, started)).reportChoice).toBeUndefined();
  });

  it("show-report moves the preview and the note, and clears the last export and copy", () => {
    const exported = run(
      started,
      finished(),
      { kind: "note", note: "written", language: "en" },
      { kind: "note", note: "declined", language: "ko" },
      { kind: "exported", outcome: "written" },
    );
    expect(exported.note).toBe("written");
    const korean = reduceReportRun(exported, {
      kind: "show-report",
      language: "ko",
    });
    expect(korean.shown).toBe("ko");
    expect(korean.preview.text).toBe("한국어 보고서");
    expect(korean.preview.state).toBe("final");
    expect(korean.note).toBe("declined");
    expect(korean.exported).toBeUndefined();
    expect(model(korean).delivery).toBeUndefined();
    // "Save as note" follows the report shown.
    expect(model(exported).buttons.saveNote).toBe(false);
    expect(model(korean).buttons.saveNote).toBe(true);
    const copied = reduceReportRun(korean, { kind: "copied" });
    const back = reduceReportRun(copied, {
      kind: "show-report",
      language: "en",
    });
    expect(back.copied).toBe(false);
    expect(back.preview.text).toBe("English report");
    expect(back.note).toBe("written");
  });

  it("a note event updates its own report and leaves the shown line alone for the other", () => {
    const state = run(started, finished());
    const after = reduceReportRun(state, {
      kind: "note",
      note: "failed",
      language: "ko",
    });
    expect(after.note).toBe("off");
    expect(after.reports.map((r) => r.note)).toEqual(["off", "failed"]);
  });

  it("asks the group question once for a run's two notes, and its answer holds for both", async () => {
    const group = {
      kind: "group-confirmation-required",
      libraryID: 5,
      groupName: "Lab",
    } as const;
    for (const [answer, state, writes] of [
      ["resume", "written", 2],
      ["cancel", "declined", 0],
    ] as const) {
      const ask = vi.fn(() => Promise.resolve(answer));
      const write = vi.fn(() =>
        Promise.resolve({ kind: "written", noteKey: "N" } as const),
      );
      const once = askOnce(ask);
      const deps = {
        ask: once,
        write,
        store: () => Promise.resolve(),
      };
      expect(await settleReportNote(group, deps)).toBe(state);
      expect(await settleReportNote(group, deps)).toBe(state);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(writes);
    }
  });

  it("a language the run did not give changes nothing", () => {
    const state = run(started, {
      kind: "finished",
      outcome: "succeeded",
      markdown: "Only one",
    });
    expect(
      reduceReportRun(state, { kind: "show-report", language: "ko" }),
    ).toBe(state);
  });
});

describe("P4-T20 — a paused run's questions", () => {
  it("the key question names the provider and says what is kept", () => {
    expect(
      reportPauseQuestion(
        { reason: "credential-required", providerId: "openrouter" },
        "OpenRouter",
      ),
    ).toEqual({
      line: {
        id: REPORT_RUN_L10N.keyNeeded,
        args: { provider: "OpenRouter" },
      },
      yes: REPORT_RUN_L10N.continue,
      no: REPORT_RUN_L10N.stop,
    });
  });

  it("the wall-clock question is the main bundle's line, for the host to format", () => {
    const question = reportPauseQuestion(
      { reason: "wall-clock-budget", done: 5, total: 12, minutes: 30 },
      "",
    );
    expect(question.line).toEqual({
      bundle: "main",
      id: "research-helper-job-wall-clock-budget",
      args: { minutes: 30, done: 5, total: 12 },
    });
  });

  it("any other pause says it waits", () => {
    expect(
      reportPauseQuestion({ reason: "user", done: 0, total: 1, minutes: 1 }, "")
        .line,
    ).toEqual({ id: REPORT_RUN_L10N.stage, args: { stage: "waiting" } });
  });

  it("a job left paused says why (item 324(a))", () => {
    expect(pausedJobQuestion("budget-stop").line).toEqual({
      id: REPORT_RUN_L10N.pausedJob,
      args: { reason: "budget-stop" },
    });
    expect(pausedJobQuestion(undefined).line).toEqual({
      id: REPORT_RUN_L10N.pausedJob,
      args: { reason: "other" },
    });
  });
});

describe("P4-T20 — the window's ids", () => {
  it("every run id is on the report window's own surface list through REPORT_WINDOW_L10N", () => {
    for (const id of Object.values(REPORT_RUN_L10N)) {
      expect(Object.values(REPORT_WINDOW_L10N)).toContain(id);
    }
  });

  it("the sink's shape is the window's to implement", () => {
    const sink: ReportWindowSink = {
      render: () => undefined,
      ask: () => Promise.resolve("cancel"),
    };
    expect(typeof sink.render).toBe("function");
  });
});

describe("P6-T17 — the audio section (docs/08 §6.4's note of 2026-11-17)", () => {
  const REPORT_EN: AudioSectionReport = {
    id: "report-en",
    language: "en",
    companionLanguage: undefined,
  };
  const VOICES: readonly AudioVoiceOption[] = [
    { id: "Charon", label: "Charon" },
    { id: "Kore", label: "Kore" },
  ];
  const NONE = { script: false, audio: false };
  const NO_BUTTONS = {
    generate: false,
    cancel: false,
    choose: false,
    saveScript: false,
    saveAudio: false,
  };
  const IDLE = { reportRunning: false };

  function fold(
    from: AudioSectionState,
    ...events: AudioSectionEvent[]
  ): AudioSectionState {
    return events.reduce(reduceAudioSection, from);
  }

  /** `null`: the lookup found no stored report. */
  function ready(
    found: AudioSectionReport | null = REPORT_EN,
  ): AudioSectionState {
    const report = found ?? undefined;
    return fold(
      IDLE_AUDIO_SECTION,
      { kind: "audio-enabled", enabled: true },
      { kind: "audio-report", report, language: "en" },
      { kind: "audio-voices", voices: VOICES, voice: "Kore" },
    );
  }

  function synthesizing(done: number, total: number): AudioReportRunView {
    return { stage: "Synthesizing", language: "ko", chunk: { done, total } };
  }

  it("is hidden while audio.enabled is off, and offers nothing", () => {
    const off = reduceAudioSection(ready(), {
      kind: "audio-enabled",
      enabled: false,
    });
    expect(off.enabled).toBe(false);
    const model = buildAudioSectionModel(off, IDLE);
    expect(model.visible).toBe(false);
    expect(model.buttons).toEqual(NO_BUTTONS);
    expect(
      buildAudioSectionModel(IDLE_AUDIO_SECTION, IDLE).visible,
      "off until the session says otherwise",
    ).toBe(false);
  });

  it("with no stored report it says so and offers nothing (Do step 2)", () => {
    const state = ready(null);
    const model = buildAudioSectionModel(state, IDLE);
    expect(model.visible).toBe(true);
    expect(model.none).toEqual({ id: AUDIO_SECTION_L10N.none });
    expect(model.language).toBeUndefined();
    expect(model.source).toBeUndefined();
    expect(model.buttons).toEqual(NO_BUTTONS);
    // A language chosen without a report changes nothing.
    expect(
      reduceAudioSection(state, { kind: "audio-language", language: "ko" }),
    ).toBe(state);
  });

  it("says nothing about a missing report before the lookup answers", () => {
    const state = fold(IDLE_AUDIO_SECTION, {
      kind: "audio-enabled",
      enabled: true,
    });
    expect(buildAudioSectionModel(state, IDLE).none).toBeUndefined();
  });

  it("a stored English report with ko chosen shows the source line", () => {
    const english = buildAudioSectionModel(ready(), IDLE);
    expect(english.source).toBeUndefined();
    expect(english.none).toBeUndefined();
    expect(english.buttons.generate).toBe(true);
    expect(english.buttons.choose).toBe(true);

    const korean = buildAudioSectionModel(
      reduceAudioSection(ready(), { kind: "audio-language", language: "ko" }),
      IDLE,
    );
    expect(korean.language).toBe("ko");
    expect(korean.source).toEqual({
      id: AUDIO_SECTION_L10N.source,
      args: { script: "ko", report: "en" },
    });
  });

  it("no source line when the same run stored a report in the chosen language", () => {
    const companion: AudioSectionReport = {
      ...REPORT_EN,
      companionLanguage: "ko",
    };
    const model = buildAudioSectionModel(
      reduceAudioSection(ready(companion), {
        kind: "audio-language",
        language: "ko",
      }),
      IDLE,
    );
    expect(model.source).toBeUndefined();
    expect(audioScriptSourceLanguage(companion, "ko")).toBe("ko");
    expect(audioScriptSourceLanguage(REPORT_EN, "ko")).toBe("en");
    expect(audioScriptSourceLanguage(REPORT_EN, "en")).toBe("en");
    expect(
      audioScriptSourceLanguage(
        { id: "r", language: "ko", companionLanguage: "en" },
        "en",
      ),
    ).toBe("en");
  });

  it("starts the voice on tts.voice when listed, else the first voice", () => {
    expect(initialAudioVoice(VOICES, "Kore")).toBe("Kore");
    expect(initialAudioVoice(VOICES, "Puck")).toBe("Charon");
    expect(initialAudioVoice([], "Kore")).toBeUndefined();
    // A voice not listed is refused; a listed one is taken.
    const state = ready();
    expect(
      reduceAudioSection(state, { kind: "audio-voice", voice: "Puck" }),
    ).toBe(state);
    expect(
      reduceAudioSection(state, { kind: "audio-voice", voice: "Charon" }).voice,
    ).toBe("Charon");
  });

  it("generate waits for a voice", () => {
    const noVoice = fold(
      IDLE_AUDIO_SECTION,
      { kind: "audio-enabled", enabled: true },
      { kind: "audio-report", report: REPORT_EN, language: "en" },
    );
    const model = buildAudioSectionModel(noVoice, IDLE);
    expect(model.buttons.generate).toBe(false);
    expect(model.buttons.choose).toBe(true);
  });

  it("generate is disabled while the report's own run is going (point 5)", () => {
    const model = buildAudioSectionModel(ready(), { reportRunning: true });
    expect(model.buttons.generate).toBe(false);
    expect(model.buttons.choose).toBe(true);
  });

  it("progress: one line by stage, chunk n of N while synthesizing", () => {
    const started = reduceAudioSection(ready(), { kind: "audio-started" });
    const first = buildAudioSectionModel(started, IDLE);
    expect(first.stage).toEqual({
      id: AUDIO_SECTION_L10N.stage,
      args: { stage: "checking", done: 0, total: 0 },
    });
    expect(first.buttons).toEqual({ ...NO_BUTTONS, cancel: true });
    const chunk = buildAudioSectionModel(
      reduceAudioSection(started, {
        kind: "audio-view",
        view: synthesizing(2, 5),
      }),
      IDLE,
    );
    expect(chunk.stage).toEqual({
      id: AUDIO_SECTION_L10N.stage,
      args: { stage: "synthesizing", done: 2, total: 5 },
    });
    for (const [stage, key] of [
      ["checking", "checking"],
      ["Scripting", "scripting"],
      ["AwaitingConfirm", "confirming"],
      ["Attaching", "attaching"],
      ["waiting", "waiting"],
      ["done", "done"],
    ] as const) {
      const line = buildAudioSectionModel(
        reduceAudioSection(started, {
          kind: "audio-view",
          // A chunk outside Synthesizing is not shown.
          view: { stage, language: "en", chunk: { done: 1, total: 3 } },
        }),
        IDLE,
      ).stage;
      expect(line).toEqual({
        id: AUDIO_SECTION_L10N.stage,
        args: { stage: key, done: 0, total: 0 },
      });
    }
    // A view after the end is ignored, and the end has no progress line.
    const ended = reduceAudioSection(started, {
      kind: "audio-finished",
      outcome: "succeeded",
      offers: NONE,
    });
    expect(
      reduceAudioSection(ended, {
        kind: "audio-view",
        view: synthesizing(1, 2),
      }),
    ).toBe(ended);
    const done = buildAudioSectionModel(ended, IDLE);
    expect(done.stage).toBeUndefined();
    expect(done.outcome).toEqual({
      id: AUDIO_SECTION_L10N.outcome,
      args: { outcome: "succeeded" },
    });
    expect(done.reason).toBeUndefined();
  });

  it("choices and a new report while running are ignored", () => {
    const started = reduceAudioSection(ready(), { kind: "audio-started" });
    expect(
      reduceAudioSection(started, { kind: "audio-language", language: "ko" }),
    ).toBe(started);
    expect(
      reduceAudioSection(started, { kind: "audio-voice", voice: "Charon" }),
    ).toBe(started);
    expect(
      reduceAudioSection(started, {
        kind: "audio-report",
        report: undefined,
        language: "en",
      }),
    ).toBe(started);
  });

  it("cancel: the outcome line, no reason, and the offers the run made", () => {
    const cancelled = fold(
      ready(),
      { kind: "audio-started" },
      { kind: "audio-view", view: synthesizing(3, 5) },
      {
        kind: "audio-finished",
        outcome: "cancelled",
        failure: { messageKey: "rh-error-cancelled", messageArgs: {} },
        offers: { script: true, audio: false },
      },
    );
    const model = buildAudioSectionModel(cancelled, IDLE);
    expect(model.stage).toBeUndefined();
    expect(model.outcome).toEqual({
      id: AUDIO_SECTION_L10N.outcome,
      args: { outcome: "cancelled" },
    });
    expect(model.reason).toBeUndefined();
    expect(model.offers).toEqual({ script: true, audio: false });
    expect(model.buttons).toEqual({
      generate: true,
      cancel: false,
      choose: true,
      saveScript: true,
      saveAudio: false,
    });
  });

  it("each save offer, its result line, and a cancelled save dialog", () => {
    const failed = fold(
      ready(),
      { kind: "audio-started" },
      {
        kind: "audio-finished",
        outcome: "failed",
        failure: {
          messageKey: "rh-error-tts",
          messageArgs: { reason: "attach" },
        },
        offers: { script: true, audio: true },
      },
    );
    const offered = buildAudioSectionModel(failed, IDLE);
    expect(offered.buttons.saveScript).toBe(true);
    expect(offered.buttons.saveAudio).toBe(true);
    expect(offered.saved).toBeUndefined();
    expect(offered.reason).toEqual({
      bundle: "main",
      id: "rh-error-tts",
      args: { reason: "attach" },
    });

    const script = reduceAudioSection(failed, {
      kind: "audio-saved",
      saveKind: "script",
      outcome: "saved",
    });
    expect(buildAudioSectionModel(script, IDLE).saved).toEqual({
      id: AUDIO_SECTION_L10N.saved,
      args: { kind: "script", outcome: "saved" },
    });
    const audio = reduceAudioSection(script, {
      kind: "audio-saved",
      saveKind: "audio",
      outcome: "failed",
    });
    expect(buildAudioSectionModel(audio, IDLE).saved).toEqual({
      id: AUDIO_SECTION_L10N.saved,
      args: { kind: "audio", outcome: "failed" },
    });
    // The save dialog cancelled: nothing changes.
    expect(
      reduceAudioSection(audio, {
        kind: "audio-saved",
        saveKind: "audio",
        outcome: "no-path",
      }),
    ).toBe(audio);
    // The next run clears the offers and the saved line.
    const next = buildAudioSectionModel(
      reduceAudioSection(audio, { kind: "audio-started" }),
      IDLE,
    );
    expect(next.offers).toEqual(NONE);
    expect(next.saved).toBeUndefined();
    expect(next.outcome).toBeUndefined();
    expect(next.buttons.saveScript).toBe(false);
    // A new report clears them too.
    const fresh = reduceAudioSection(audio, {
      kind: "audio-report",
      report: REPORT_EN,
      language: "en",
    });
    expect(fresh.offers).toEqual(NONE);
    expect(fresh.saved).toBeUndefined();
    expect(fresh.outcome).toBeUndefined();
  });

  it("a failure's unknown message falls back to rh-error-tts", () => {
    const state = reduceAudioSection(ready(), {
      kind: "audio-finished",
      outcome: "failed",
      failure: { messageKey: "not-an-id", messageArgs: { x: "y" } },
      offers: NONE,
    });
    expect(buildAudioSectionModel(state, IDLE).reason).toEqual({
      bundle: "main",
      id: "rh-error-tts",
      args: { reason: "other" },
    });
    // A failure's message shows only for a failed outcome.
    expect(
      buildAudioSectionModel({ ...state, outcome: "declined" }, IDLE).reason,
    ).toBeUndefined();
  });

  it("the tier refusal is the main bundle's line; other refusals are worded here", () => {
    const refuse = (refusal: AudioRefusalReason) =>
      buildAudioSectionModel(
        reduceAudioSection(ready(), {
          kind: "audio-finished",
          outcome: "refused",
          refusal,
          offers: NONE,
        }),
        IDLE,
      ).reason;
    expect(refuse("tier-refused")).toEqual({
      bundle: "main",
      id: L10N_AUDIO_TIER_REFUSED,
    });
    for (const reason of [
      "no-report",
      "no-key",
      "read-only",
      "no-collection",
      "linked-needs-personal-library",
      "no-folder",
      "disabled",
    ] as const) {
      expect(refuse(reason)).toEqual({
        id: AUDIO_SECTION_L10N.refused,
        args: { reason },
      });
    }
    // Any other refusal reads "other".
    expect(refuse("something-else" as AudioRefusalReason)).toEqual({
      id: AUDIO_SECTION_L10N.refused,
      args: { reason: "other" },
    });
  });

  it("windowAudioModel hands the window the main-bundle reason as text", () => {
    const model = buildAudioSectionModel(
      reduceAudioSection(ready(), {
        kind: "audio-finished",
        outcome: "refused",
        refusal: "tier-refused",
        offers: NONE,
      }),
      IDLE,
    );
    const out = windowAudioModel(model, (line) =>
      line.id === L10N_AUDIO_TIER_REFUSED ? "refused text" : undefined,
    );
    expect(out.reason).toEqual({ text: "refused text" });
    expect(out.outcome).toEqual(model.outcome);
  });

  it("every audio id is on the report window's surface list", () => {
    for (const id of Object.values(AUDIO_SECTION_L10N)) {
      expect(REPORT_WINDOW_MESSAGE_IDS).toContain(id);
    }
    expect(REPORT_WINDOW_AUDIO_L10N).toBe(AUDIO_SECTION_L10N);
  });
});

describe("P6-T17 — Generate Audio Report… on the collection menu", () => {
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
    return (
      collectionMenuOptions({
        openSearchWindow: () => undefined,
        onError: () => undefined,
        ...commands,
      }).menus[0]?.menus ?? []
    );
  }
  const isAudio = (entry: { readonly l10nID?: string }): boolean =>
    entry.l10nID === L10N_MENU_COLLECTION_AUDIO_REPORT;
  const open = () => undefined;

  it("is left out while audio.enabled is off, or nothing can open the window", () => {
    expect(
      entriesOf({
        audioEnabled: () => false,
        openAudioReportWindow: open,
      }).some(isAudio),
    ).toBe(false);
    expect(entriesOf({ openAudioReportWindow: open }).some(isAudio)).toBe(
      false,
    );
    expect(entriesOf({ audioEnabled: () => true }).some(isAudio)).toBe(false);
  });

  it("sits right after the report entry when on", () => {
    const entries = entriesOf({
      openReportWindow: open,
      audioEnabled: () => true,
      openAudioReportWindow: open,
    });
    expect(entries.map((entry) => entry.l10nID ?? entry.menuType)).toEqual([
      L10N_MENU_COLLECTION_REPORT,
      L10N_MENU_COLLECTION_AUDIO_REPORT,
      "separator",
      L10N_MENU_COLLECTION_SEARCH_IMPORT,
      L10N_MENU_COLLECTION_RERUN,
    ]);
  });

  it("shows for one collection only, and goes when the preference goes off", () => {
    let enabled = true;
    const [entry] = entriesOf({
      audioEnabled: () => enabled,
      openAudioReportWindow: open,
    }).filter(isAudio);
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

  it("opens the window on the one collection, and reports a failed visibility check", () => {
    const calls: unknown[][] = [];
    const errors: string[] = [];
    const [entry] = entriesOf({
      audioEnabled: () => {
        if (calls.length > 0) throw new Error("no preference store");
        return true;
      },
      openAudioReportWindow: (host, collectionID) => {
        calls.push([host, collectionID]);
      },
      onError: (text) => {
        errors.push(text);
      },
    }).filter(isAudio);
    const { host, context } = contextOf([4245]);
    entry?.onCommand?.(new Event("command"), context);
    expect(calls).toStrictEqual([[host, 4245]]);
    entry?.onShowing?.(new Event("popupshowing"), context);
    expect(errors).toStrictEqual([
      "Audio report entry visibility check failed",
    ]);
    // Two collections: refused, nothing opened.
    entry?.onCommand?.(new Event("command"), contextOf([1, 2]).context);
    expect(calls).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });
});

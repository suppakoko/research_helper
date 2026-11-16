/**
 * `P3-T16` step 2 and step 6: the cost confirmation dialog's model, the rule
 * for when it opens (`docs/09` §3.6's dated note of 2026-10-23), the second
 * acknowledgement enforced on the privileged side, the abstract-only
 * downgrade, the ceiling question, and the Usage readout. Every figure is
 * SYNTHETIC; no window, no network, no LLM call.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { L10N_AUDIO_TIER_REFUSED } from "../../../src/i18n/keys";
import type { AudioPlan } from "../../../src/model/audio";
import { audioEgressNotice } from "../../../src/pipeline/audioReport/disclosure";
import {
  estimateAudioPlan,
  type ScriptStepEstimate,
} from "../../../src/pipeline/audioReport/estimate";
import { chunkScript } from "../../../src/tts/chunk";
import {
  ZERO_SPEND,
  type CeilingStop,
  type SpendTotals,
} from "../../../src/pipeline/shared/budget";
import {
  buildEgressDisclosure,
  mustAskConfirmation,
  routineConfirmationFor,
  type EgressDisclosure,
} from "../../../src/pipeline/shared/egressDisclosure";
import {
  estimateReportRun,
  estimateRun,
  OTHER_THEME_RESERVE,
  themeCountBandFor,
  type EstimateItem,
  type ReportRunEstimate,
  type RunEstimate,
} from "../../../src/pipeline/shared/estimate";
import {
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
  createPromptRegistry,
} from "../../../src/prompts";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import {
  AUDIO_COST_L10N,
  COST_DIALOG_L10N,
  COST_DIALOG_URL,
  REPORT_COST_L10N,
  USAGE_L10N,
  buildAudioDialogModel,
  buildCostDialogModel,
  createUsageHost,
  decideCostDialog,
  formatCount,
  formatMegabytes,
  formatMinutes,
  formatUsd,
  openCostConfirmDialog,
  shouldOpenCostDialog,
  skippedNoticeLine,
  usageReadout,
  type AudioPlanDialogInput,
  type CostDialogArgs,
  type PreflightDialogInput,
  type PreflightDialogModel,
} from "../../../src/ui/dialogs/costConfirmDialog";

const LOCALE = "en-US";

const PRICES: ModelPrices = {
  inputPerMTokUsd: 3,
  outputPerMTokUsd: 15,
  cachedInputPerMTokUsd: undefined,
  tiers: [],
  asOfEpochMs: Date.UTC(2026, 8, 8),
  source: "documented-table",
};

const ABSTRACT = "a".repeat(1_480); // 400 tokens
const BODY = "b".repeat(33_300); // 9 000 tokens

function item(key: string, fullText: boolean): EstimateItem {
  return {
    workKey: key,
    cached: false,
    source: fullText
      ? { tier: "fulltext_pdf", abstract: ABSTRACT, text: BODY }
      : { tier: "abstract", abstract: ABSTRACT, text: ABSTRACT },
  };
}

function estimate(count: number, priced = true): RunEstimate {
  const prices: ModelPrices | undefined = priced ? PRICES : undefined;
  return estimateRun({
    items: Array.from({ length: count }, (_, i) =>
      item(String(i), i % 2 === 0),
    ),
    fullTextMode: "auto",
    modelId: "mock-small",
    prices,
    overhead: {
      PAPER_SUMMARY_ABSTRACT: 3_000,
      PAPER_SUMMARY_FULLTEXT: 3_000,
      CHUNK_MAP: 3_000,
      CHUNK_REDUCE: 3_000,
    },
    fullTextAutoMaxPapers: 25,
    atEpochMs: Date.UTC(2026, 9, 23),
    countTokens: (t) => estTokens(t),
  });
}

function disclosure(
  providerId: "openrouter" | "gemini" = "openrouter",
  options: { paid?: boolean; acknowledged?: boolean } = {},
): EgressDisclosure {
  return buildEgressDisclosure(
    {
      providerId,
      modelId: "mock-small",
      privacyMode: "balanced",
      items: ["abstract+fulltext", "abstract"],
    },
    {
      baseUrls: { effectiveHost: () => "proxy.example.invalid" },
      egressAcknowledged: () => options.acknowledged ?? true,
      geminiPaidTier: () => options.paid ?? false,
    },
  );
}

function preflight(
  overrides: Partial<PreflightDialogInput> = {},
): PreflightDialogInput {
  return {
    mode: "preflight",
    estimate: estimate(4),
    disclosure: disclosure(),
    confirmAboveCents: 200,
    fullTextAutoMaxPapers: 25,
    providerName: "OpenRouter",
    ceilingSelected: undefined,
    ceilingDowngrade: undefined,
    session: ZERO_SPEND,
    ...overrides,
  };
}

function asPreflight(input: PreflightDialogInput): PreflightDialogModel {
  const model = buildCostDialogModel(input, LOCALE);
  if (model.mode !== "preflight") throw new Error("not a preflight model");
  return model;
}

const STOP: CeilingStop = {
  ceiling: "run",
  limitUsd: 0.01,
  spentUsd: 0,
  projectedUsd: 0.123,
  runSpentUsd: 0,
};

describe("when the dialog opens (docs/09 §3.6's note, 2026-10-23)", () => {
  const plan = { calls: 3, costUsd: 0.5 };
  const quiet = mustAskConfirmation(
    disclosure(),
    routineConfirmationFor(disclosure()),
  );

  it("follows mustAskConfirmation for the routine question", () => {
    expect(quiet.ask).toBe(false);
    expect(
      shouldOpenCostDialog({
        confirmation: quiet,
        plan,
        confirmAboveCents: 200,
        ceiling: undefined,
      }),
    ).toEqual({ open: false, reasons: [] });
    const fresh = mustAskConfirmation(disclosure(), undefined);
    expect(
      shouldOpenCostDialog({
        confirmation: fresh,
        plan,
        confirmAboveCents: 200,
        ceiling: undefined,
      }).reasons,
    ).toEqual(["routine"]);
  });

  it("opens for money whatever 'don't ask again' says: above the threshold, an unknown price, a ceiling", () => {
    const open = (
      p: { calls: number; costUsd: number | undefined },
      ceiling?: CeilingStop,
    ) =>
      shouldOpenCostDialog({
        confirmation: quiet,
        plan: p,
        confirmAboveCents: 200,
        ceiling,
      });
    expect(open({ calls: 3, costUsd: 2.5 }).reasons).toEqual([
      "above-threshold",
    ]);
    expect(open({ calls: 3, costUsd: undefined }).reasons).toEqual([
      "unknown-cost",
    ]);
    expect(open(plan, STOP).reasons).toEqual(["ceiling"]);
  });

  it("forces the question for the Gemini declared-paid reminder, which the dialog then shows", () => {
    const gemini = disclosure("gemini", { paid: true });
    const decision = mustAskConfirmation(
      gemini,
      routineConfirmationFor(gemini),
    );
    expect(
      shouldOpenCostDialog({
        confirmation: decision,
        plan,
        confirmAboveCents: 200,
        ceiling: undefined,
      }).open,
    ).toBe(true);
    const model = asPreflight(preflight({ disclosure: gemini }));
    expect(model.notices.map((n) => n.id)).toEqual([
      "research-helper-egress-gemini-declared-paid",
    ]);
  });

  it("never opens for a run that makes no call, and a skipped dialog still leaves the number", () => {
    expect(
      shouldOpenCostDialog({
        confirmation: mustAskConfirmation(disclosure(), undefined),
        plan: { calls: 0, costUsd: 0 },
        confirmAboveCents: 0,
        ceiling: STOP,
      }).open,
    ).toBe(false);
    expect(skippedNoticeLine(plan, LOCALE)).toEqual({
      id: COST_DIALOG_L10N.skippedNotice,
      args: { cost: "$0.50", calls: 3 },
    });
  });
});

describe("the pre-run model", () => {
  it("embeds the disclosure: items, provider, the effective host, model and mode, and its notices", () => {
    const model = asPreflight(
      preflight({
        disclosure: disclosure("openrouter", { acknowledged: false }),
      }),
    );
    expect(model.header[1]).toEqual({
      id: COST_DIALOG_L10N.destination,
      args: {
        provider: "OpenRouter",
        host: "proxy.example.invalid",
        model: "mock-small",
        mode: "balanced",
      },
    });
    expect(model.notices.map((n) => n.id)).toEqual([
      "research-helper-egress-first-job-notice",
    ]);
    expect(model.footer.at(-1)?.id).toBe(COST_DIALOG_L10N.disclaimer);
  });

  it("asks for the second acknowledgement above summary.confirmAboveCents, naming the figure", () => {
    const cheap = asPreflight(preflight({ confirmAboveCents: 10_000 }));
    expect(cheap.selected.acknowledge).toBeUndefined();
    const dear = asPreflight(preflight({ confirmAboveCents: 1 }));
    expect(dear.selected.acknowledge?.id).toBe(COST_DIALOG_L10N.acknowledge);
    expect(dear.selected.lines.map((l) => l.id)).toContain(
      COST_DIALOG_L10N.aboveThreshold,
    );
    const unpriced = asPreflight(preflight({ estimate: estimate(4, false) }));
    expect(unpriced.selected.acknowledge?.id).toBe(
      COST_DIALOG_L10N.acknowledgeUnpriced,
    );
    expect(unpriced.selected.lines.map((l) => l.id)).toContain(
      COST_DIALOG_L10N.unpriced,
    );
    expect(unpriced.footer.map((l) => l.id)).not.toContain(
      COST_DIALOG_L10N.disclaimer,
    );
  });

  it("offers the downgrade with its own price, and pre-selects it above summary.fullTextAutoMaxPapers", () => {
    const small = asPreflight(preflight());
    expect(small.downgrade?.preselected).toBe(false);
    expect(small.downgrade?.note).toBeUndefined();
    const large = asPreflight(preflight({ estimate: estimate(30) }));
    expect(large.downgrade?.preselected).toBe(true);
    expect(large.downgrade?.note).toEqual({
      id: COST_DIALOG_L10N.downgradePreselected,
      args: { max: 25 },
    });
    const abstractsOnly = estimate(1); // one item, i = 0 → full text
    expect(abstractsOnly.selected.counts.fullText).toBe(1);
  });

  it("names a ceiling the estimate would pass and the raise running applies", () => {
    const model = asPreflight(preflight({ ceilingSelected: STOP }));
    expect(model.selected.raise).toMatchObject({
      ceiling: "run",
      limitUsd: 0.13,
    });
    expect(model.selected.raise?.line).toEqual({
      id: COST_DIALOG_L10N.ceilingPreflight,
      args: { ceiling: "run", limit: "$0.01", spent: "$0.00", raised: "$0.13" },
    });
  });
});

describe("the answer, checked again on the privileged side", () => {
  const dear = asPreflight(preflight({ confirmAboveCents: 1 }));

  it("runs nothing without an explicit accept, or without a required acknowledgement", () => {
    expect(decideCostDialog(dear, { accepted: false })).toEqual({
      kind: "cancelled",
    });
    expect(decideCostDialog(dear, { accepted: true })).toEqual({
      kind: "cancelled",
    });
    expect(decideCostDialog(dear, "yes")).toEqual({ kind: "cancelled" });
    expect(decideCostDialog(dear, null)).toEqual({ kind: "cancelled" });
  });

  it("runs the selected plan once acknowledged, and records 'don't ask again' only when ticked", () => {
    expect(
      decideCostDialog(dear, { accepted: true, acknowledged: true }),
    ).toEqual({
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: false,
    });
    expect(
      decideCostDialog(dear, {
        accepted: true,
        acknowledged: true,
        dontAskAgain: true,
      }),
    ).toMatchObject({ dontAskAgain: true });
  });

  it("runs the downgrade under the downgrade's own acknowledgement rule", () => {
    const model = asPreflight(preflight({ confirmAboveCents: 15 }));
    // The full-text plan (about $0.19) is above $0.15; the abstract-only one
    // (about $0.12) is not.
    expect(model.selected.acknowledge).toBeDefined();
    expect(model.downgrade?.plan.acknowledge).toBeUndefined();
    expect(
      decideCostDialog(model, { accepted: true, downgrade: true }),
    ).toMatchObject({ kind: "run", plan: "abstract-only" });
  });

  it("carries the raise of a ceiling the chosen plan would pass", () => {
    const model = asPreflight(preflight({ ceilingSelected: STOP }));
    expect(decideCostDialog(model, { accepted: true })).toMatchObject({
      kind: "run",
      raise: { ceiling: "run", limitUsd: 0.13 },
    });
  });

  it("the ceiling moment: continue raises for this run, anything else stops", () => {
    const model = buildCostDialogModel(
      {
        mode: "ceiling",
        stop: { ...STOP, spentUsd: 0.04, runSpentUsd: 0.04 },
        remainingUsd: 0.2,
        raiseToUsd: 0.25,
        usage: {
          run: { ...ZERO_SPEND, calls: 2, costUsd: 0.04 },
          session: {
            ...ZERO_SPEND,
            calls: 2,
            costUsd: 0.04,
            estimatedCalls: 1,
          },
        },
      },
      LOCALE,
    );
    expect(model.mode).toBe("ceiling");
    if (model.mode !== "ceiling") return;
    expect(model.lines.map((l) => l.id)).toEqual([
      COST_DIALOG_L10N.ceilingReached,
      COST_DIALOG_L10N.usageJob,
      COST_DIALOG_L10N.usageSession,
      COST_DIALOG_L10N.usageEstimated,
    ]);
    expect(decideCostDialog(model, { accepted: true })).toEqual({
      kind: "continue",
      raise: { ceiling: "run", limitUsd: 0.25 },
    });
    expect(decideCostDialog(model, { accepted: false })).toEqual({
      kind: "stop",
    });
  });
});

describe("opening the window", () => {
  it("hands the model over, resolves on the first answer only, and gives each dialog its own window", async () => {
    const opened: { url: unknown; name: unknown; args: CostDialogArgs }[] = [];
    const host = {
      openDialog(url?: string, name?: string, _f?: string, ...rest: unknown[]) {
        opened.push({ url, name, args: rest[0] as CostDialogArgs });
        return {};
      },
    };
    const model = asPreflight(preflight());
    const first = openCostConfirmDialog(host, model);
    const second = openCostConfirmDialog(host, model);
    expect(opened[0]?.url).toBe(COST_DIALOG_URL);
    expect(opened[0]?.name).not.toBe(opened[1]?.name);
    expect(opened[0]?.args.model).toBe(model);
    opened[0]?.args.onAnswer({ accepted: true });
    opened[0]?.args.onAnswer({ accepted: false });
    opened[1]?.args.onAnswer({ accepted: false });
    await expect(first).resolves.toMatchObject({ kind: "run" });
    await expect(second).resolves.toEqual({ kind: "cancelled" });
  });

  it("rejects when no window opens: nothing runs without a number", async () => {
    await expect(
      openCostConfirmDialog(
        { openDialog: () => null },
        asPreflight(preflight()),
      ),
    ).rejects.toThrow(/returned no window/);
  });
});

describe("the Usage readout (step 6)", () => {
  const session: SpendTotals = {
    ...ZERO_SPEND,
    calls: 3,
    inputTokens: 12_345,
    outputTokens: 678,
    costUsd: 0.0123,
  };

  it("shows the session's calls, tokens and dollars and its ceiling, and says when figures are estimated", () => {
    expect(usageReadout(session, 500, LOCALE)).toEqual([
      {
        id: USAGE_L10N.session,
        args: { calls: 3, input: "12,345", output: "678", cost: "$0.01" },
      },
      { id: USAGE_L10N.limit, args: { limit: "$5.00" } },
    ]);
    expect(
      usageReadout({ ...session, unpricedCalls: 1 }, 0, LOCALE).map(
        (l) => l.id,
      ),
    ).toEqual([USAGE_L10N.session, USAGE_L10N.estimated, USAGE_L10N.limitOff]);
  });

  it("reads the counter and the preference each time it is asked", () => {
    let totals = ZERO_SPEND;
    let cents = 500;
    const host = createUsageHost({
      session: () => totals,
      sessionLimitCents: () => cents,
      locale: () => LOCALE,
    });
    expect(host.readout()[0]?.args?.["calls"]).toBe(0);
    totals = session;
    cents = 0;
    expect(host.readout()[0]?.args?.["calls"]).toBe(3);
    expect(host.readout().at(-1)?.id).toBe(USAGE_L10N.limitOff);
  });

  it("keeps a sub-cent amount readable", () => {
    expect(formatUsd(0.0042, LOCALE)).toBe("$0.0042");
    expect(formatUsd(2.9, LOCALE)).toBe("$2.90");
    expect(formatUsd(0, LOCALE)).toBe("$0.00");
  });
});

describe("the bundles and the window script", () => {
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");
  const enUS = read("addon/locale/en-US/research-helper-mainWindow.ftl");
  const koKR = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");
  const ids = [
    ...new Set([
      ...Object.values(COST_DIALOG_L10N),
      ...Object.values(USAGE_L10N),
    ]),
  ];

  it("declares every id in en-US and in ko-KR as the owner-reviewed Korean (2026-10-23, G-41)", () => {
    for (const id of [...ids, "rh-error-budget"]) {
      expect(enUS, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(koKR, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(koKR, id).not.toMatch(new RegExp(`^# ${id} =`, "m"));
    }
  });

  it("states FR-24's words in the disclaimer and the skipped notice", () => {
    for (const id of [
      COST_DIALOG_L10N.disclaimer,
      COST_DIALOG_L10N.skippedNotice,
    ]) {
      const start = enUS.indexOf(`${id} =`);
      expect(enUS.slice(start, enUS.indexOf("\n\n", start) + 400)).toContain(
        "actual cost may differ",
      );
    }
  });

  it("the window script keeps accept disabled until a required acknowledgement is ticked", () => {
    const code = read("addon/content/costConfirm.js");
    const factory = new Function(`${code}\nreturn RHCostDialog;`) as () => {
      logic: {
        canAccept(model: unknown, downgrade: boolean, ack: boolean): boolean;
      };
    };
    const { logic } = factory();
    const dear = asPreflight(preflight({ confirmAboveCents: 15 }));
    expect(logic.canAccept(dear, false, false)).toBe(false);
    expect(logic.canAccept(dear, false, true)).toBe(true);
    expect(logic.canAccept(dear, true, false)).toBe(true);
    expect(logic.canAccept({ mode: "ceiling" }, false, false)).toBe(true);
    expect(code).not.toMatch(/Zotero\.Prefs|Zotero\.HTTP|fetch\(/);
  });
});

describe("the pane paints the Usage section from api.usage (preferences.js, shipped bytes)", () => {
  interface StubElement {
    id?: string;
    children: StubElement[];
    l10n?: { id: string; args?: unknown };
    readonly firstChild: StubElement | undefined;
    appendChild(child: StubElement): void;
    remove(): void;
  }
  function element(id?: string): StubElement {
    const el: StubElement = {
      ...(id !== undefined && { id }),
      children: [],
      get firstChild() {
        return el.children[0];
      },
      appendChild(child) {
        el.children.push(child);
        child.remove = () => {
          el.children.splice(el.children.indexOf(child), 1);
        };
      },
      remove() {},
    };
    return el;
  }

  function load(usage: unknown) {
    const container = element("rh-prefs-usage-lines");
    const document = {
      getElementById: (id: string) => (id === container.id ? container : null),
      createElementNS: () => element(),
      l10n: {
        setAttributes(el: StubElement, id: string, args?: unknown) {
          el.l10n = { id, args };
        },
      },
    };
    const Zotero = { __addonInstance__: { api: { usage } }, debug() {} };
    const code = readFileSync(
      resolve(process.cwd(), "addon/content/preferences.js"),
      "utf8",
    );
    const factory = new Function(
      "Zotero",
      "document",
      "window",
      `${code}\nreturn RHPreferences;`,
    ) as (z: unknown, d: unknown, w: unknown) => { paintUsage(): void };
    return { pane: factory(Zotero, document, undefined), container };
  }

  it("places each line the host returns, twice without duplicating, and nothing without a host", () => {
    const lines = usageReadout({ ...ZERO_SPEND, calls: 2 }, 500, LOCALE);
    const { pane, container } = load({ readout: () => lines });
    pane.paintUsage();
    pane.paintUsage();
    expect(container.children.map((c) => c.l10n)).toEqual(
      lines.map((l) => ({ id: l.id, args: l.args })),
    );
    const empty = load(undefined);
    empty.pane.paintUsage();
    expect(empty.container.children).toEqual([]);
  });
});

describe("item 281(b) — a run over no collection offers no 'Don't ask again' (owner, 2026-10-24)", () => {
  it("leaves the box out of the model when asked to, and offers it otherwise", () => {
    expect(asPreflight(preflight()).dontAskAgain).toEqual({
      id: COST_DIALOG_L10N.dontAskAgain,
    });
    expect(
      asPreflight(preflight({ offerDontAskAgain: true })).dontAskAgain,
    ).toEqual({ id: COST_DIALOG_L10N.dontAskAgain });
    expect(
      asPreflight(preflight({ offerDontAskAgain: false })).dontAskAgain,
    ).toBeUndefined();
  });

  it("never records 'don't ask again' from a window that was not offered the box", () => {
    const model = asPreflight(
      preflight({ confirmAboveCents: 1, offerDontAskAgain: false }),
    );
    expect(
      decideCostDialog(model, {
        accepted: true,
        acknowledged: true,
        dontAskAgain: true,
      }),
    ).toEqual({
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: false,
    });
  });

  it("the window script keeps the box hidden when the model has none", () => {
    const code = readFileSync(
      resolve(process.cwd(), "addon/content/costConfirm.js"),
      "utf8",
    );
    interface Fake {
      hidden: boolean;
      checked: boolean;
      firstChild: null;
      readonly attrs: Map<string, string>;
      setAttribute(name: string, value: string): void;
      appendChild(): void;
      addEventListener(): void;
    }
    const fake = (): Fake => ({
      hidden: true,
      checked: false,
      firstChild: null,
      attrs: new Map(),
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
      },
      appendChild: () => undefined,
      addEventListener: () => undefined,
    });
    const paint = (model: PreflightDialogModel): Fake => {
      const elements = new Map<string, Fake>();
      const doc = {
        getElementById: (id: string): Fake => {
          const found = elements.get(id) ?? fake();
          elements.set(id, found);
          return found;
        },
        createElementNS: fake,
      };
      const factory = new Function(
        "document",
        `${code}\nreturn RHCostDialog;`,
      ) as (d: unknown) => {
        spec: { dontAsk: string };
        io: unknown;
        renderPreflight(m: unknown): void;
      };
      const dialog = factory(doc);
      dialog.io = { model };
      dialog.renderPreflight(model);
      return doc.getElementById(dialog.spec.dontAsk);
    };
    const offered = paint(asPreflight(preflight()));
    expect(offered.hidden).toBe(false);
    expect(offered.attrs.get("data-l10n-id")).toBe(
      COST_DIALOG_L10N.dontAskAgain,
    );
    const absent = paint(asPreflight(preflight({ offerDontAskAgain: false })));
    expect(absent.hidden).toBe(true);
    expect(absent.attrs.has("data-l10n-id")).toBe(false);
  });
});

describe("P4-T16 — a report run's estimate in the same dialog", () => {
  const prompts = createPromptRegistry(
    PROMPT_IDS.map((id) => ({
      fileName: PROMPT_FILE_NAMES[id],
      text: readFileSync(
        resolve(process.cwd(), "src/prompts", PROMPT_FILE_NAMES[id]),
        "utf8",
      ),
    })),
  );
  const overhead = 2_000;

  function reportEstimate(
    options: {
      reportPriced?: boolean;
      cached?: boolean;
      /** Default 4. */
      papers?: number;
      /** Default 3; `null` leaves K to the band (item 309(c)). */
      themeCount?: number | null;
    } = {},
  ): ReportRunEstimate {
    const themeCount =
      options.themeCount === undefined ? 3 : options.themeCount;
    return estimateReportRun({
      items: Array.from({ length: options.papers ?? 4 }, (_, i) => ({
        ...item(String(i), i % 2 === 0),
        cached: options.cached ?? false,
      })),
      fullTextMode: "auto",
      mapModel: { modelId: "vendor/small", prices: PRICES },
      reportModel: {
        modelId: "vendor/strong",
        prices: options.reportPriced === false ? undefined : PRICES,
        maxOutputTokens: 64_000,
      },
      critiqueModel: { modelId: "vendor/critic", prices: PRICES },
      prompts,
      synthesisOverhead: {
        THEME_CLUSTER: overhead,
        THEME_MERGE: overhead,
        CLUSTER_REDUCE: overhead,
        CLUSTER_REDUCE_MERGE: overhead,
        TREND_REPORT_EN: overhead,
        TREND_REPORT_KO: overhead,
        SELF_CRITIQUE: overhead,
      },
      languages: ["en"],
      critiqueRounds: 1,
      ...(themeCount !== null && { themeCount }),
      overhead: {
        PAPER_SUMMARY_ABSTRACT: 3_000,
        PAPER_SUMMARY_FULLTEXT: 3_000,
        CHUNK_MAP: 3_000,
        CHUNK_REDUCE: 3_000,
      },
      fullTextAutoMaxPapers: 25,
      atEpochMs: Date.UTC(2026, 9, 27),
      countTokens: (t) => estTokens(t),
    });
  }

  function reportDisclosure(): EgressDisclosure {
    return buildEgressDisclosure(
      {
        providerId: "openrouter",
        modelId: "vendor/strong",
        privacyMode: "balanced",
        items: ["abstract+fulltext", "abstract"],
        report: {
          papers: 4,
          models: {
            map: "vendor/small",
            report: "vendor/strong",
            critique: "vendor/critic",
          },
        },
      },
      {
        baseUrls: { effectiveHost: () => "proxy.example.invalid" },
        egressAcknowledged: () => true,
      },
    );
  }

  it("shows the run's totals, then which model is paid for what", () => {
    const run = reportEstimate();
    const model = asPreflight(
      preflight({ estimate: run, disclosure: reportDisclosure() }),
    );
    expect(model.selected.lines.slice(0, 4)).toEqual([
      { id: COST_DIALOG_L10N.calls, args: { calls: 4 + 6 + 1 } },
      {
        id: REPORT_COST_L10N.summaries,
        args: { calls: 4, model: "vendor/small" },
      },
      {
        id: REPORT_COST_L10N.writing,
        args: { calls: 6, themes: 3, model: "vendor/strong" },
      },
      {
        id: REPORT_COST_L10N.review,
        args: { calls: 1, model: "vendor/critic" },
      },
    ]);
    expect(model.selected.lines).toContainEqual({
      id: COST_DIALOG_L10N.total,
      args: { cost: formatUsd(run.selected.costUsd as number, LOCALE) },
    });
  });

  it("names K + 1 themes, the number the estimate reserved, when K comes from the band (plan/00 §6 item 309(c))", () => {
    // 30 papers: the 26–75 band's K is 7, so 8 themes with Other; 1 cluster
    // call, 9 theme calls and 1 merge (item 309(b)), the report and a rewrite.
    const run = reportEstimate({ papers: 30, themeCount: null });
    expect(run.selected.synthesis.themes).toBe(
      themeCountBandFor(30).maxThemes + OTHER_THEME_RESERVE,
    );
    const model = asPreflight(
      preflight({ estimate: run, disclosure: reportDisclosure() }),
    );
    expect(model.selected.lines).toContainEqual({
      id: REPORT_COST_L10N.writing,
      args: { calls: 1 + 9 + 1 + 1 + 1, themes: 8, model: "vendor/strong" },
    });
  });

  it("drops the summaries line when every summary exists", () => {
    const model = asPreflight(
      preflight({
        estimate: reportEstimate({ cached: true }),
        disclosure: reportDisclosure(),
      }),
    );
    const ids = model.selected.lines.map((l) => l.id);
    expect(ids).not.toContain(REPORT_COST_L10N.summaries);
    expect(ids).toContain(REPORT_COST_L10N.writing);
  });

  it("places the report notice first, naming every model as a list", () => {
    const model = asPreflight(
      preflight({ estimate: reportEstimate(), disclosure: reportDisclosure() }),
    );
    expect(model.notices[0]).toEqual({
      id: REPORT_COST_L10N.notice,
      args: {
        papers: 4,
        models: "vendor/small, vendor/strong, and vendor/critic",
      },
    });
  });

  it("an unpriced report model names that model and demands the unpriced acknowledgement", () => {
    const run = reportEstimate({ reportPriced: false });
    const model = asPreflight(
      preflight({ estimate: run, disclosure: reportDisclosure() }),
    );
    expect(model.selected.lines).toContainEqual({
      id: COST_DIALOG_L10N.unpriced,
      args: { model: "vendor/strong" },
    });
    expect(model.selected.acknowledge).toEqual({
      id: COST_DIALOG_L10N.acknowledgeUnpriced,
    });
    expect(decideCostDialog(model, { accepted: true })).toEqual({
      kind: "cancelled",
    });
    expect(
      decideCostDialog(model, { accepted: true, acknowledged: true }).kind,
    ).toBe("run");
  });

  it("'don't ask again' never skips a question forced by money (item 274(b))", () => {
    const d = reportDisclosure();
    const quiet = mustAskConfirmation(d, routineConfirmationFor(d));
    expect(quiet.ask).toBe(false);
    expect(
      shouldOpenCostDialog({
        confirmation: quiet,
        plan: reportEstimate({ reportPriced: false }).selected,
        confirmAboveCents: 200,
        ceiling: undefined,
      }).reasons,
    ).toEqual(["unknown-cost"]);
    const priced = reportEstimate();
    expect(
      shouldOpenCostDialog({
        confirmation: quiet,
        plan: priced.selected,
        confirmAboveCents: 1,
        ceiling: undefined,
      }).reasons,
    ).toEqual(["above-threshold"]);
    expect(
      shouldOpenCostDialog({
        confirmation: quiet,
        plan: priced.selected,
        confirmAboveCents: 1_000_000,
        ceiling: STOP,
      }).reasons,
    ).toEqual(["ceiling"]);
  });

  it("leaves a summarize run's model without a single report line", () => {
    const model = asPreflight(preflight());
    const ids = JSON.stringify(model);
    for (const id of Object.values(REPORT_COST_L10N)) {
      expect(ids).not.toContain(id);
    }
    expect(model.selected.lines.map((l) => l.id).slice(0, 3)).toEqual([
      COST_DIALOG_L10N.calls,
      COST_DIALOG_L10N.input,
      COST_DIALOG_L10N.output,
    ]);
  });

  it("declares the report's ids in en-US, and in ko-KR as the owner-reviewed Korean (2026-10-27, G-41, item 292(a)), not as stubs", () => {
    const read = (path: string) =>
      readFileSync(resolve(process.cwd(), path), "utf8");
    const enUS = read("addon/locale/en-US/research-helper-mainWindow.ftl");
    const koKR = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");
    for (const id of Object.values(REPORT_COST_L10N)) {
      expect(enUS, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(koKR, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(koKR, id).not.toMatch(new RegExp(`^# ${id} =`, "m"));
    }
  });

  it("ships the approved Korean of plan/00 §6 item 292(a) verbatim, taking every argument the dialog passes", () => {
    const koKR = readFileSync(
      resolve(
        process.cwd(),
        "addon/locale/ko-KR/research-helper-mainWindow.ftl",
      ),
      "utf8",
    );
    // The entry's text from its `=` up to the next entry, with Korean's one
    // plural variant (`{ $calls -> *[other] … }`) unwrapped.
    const entry = (id: string): string => {
      const start = koKR.indexOf(`\n${id} =`);
      expect(start, id).toBeGreaterThan(-1);
      const end = koKR.indexOf("\nresearch-helper-", start + 1);
      const body = koKR
        .slice(start + id.length + 3, end === -1 ? undefined : end)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .join(" ");
      const variant = /^\{ \$calls -> \*\[other\] (.*) \}$/.exec(body);
      return variant?.[1] ?? body;
    };
    const approved: Record<string, string> = {
      [REPORT_COST_L10N.notice]:
        "보고서를 쓰기 위해 논문 { $papers }편의 요약과 각 논문의 제목, 연도, 게재처, 그리고 논문이 속한 주제에 대한 통계를 { $models }에 보냅니다. 논문 자체는 다시 보내지 않습니다.",
      [REPORT_COST_L10N.summaries]:
        "아직 만들 요약: { $model }에 { $calls }회 호출.",
      [REPORT_COST_L10N.writing]:
        "논문을 최대 { $themes }개 주제로 묶고 보고서 작성: { $model }에 최대 { $calls }회 호출.",
      [REPORT_COST_L10N.review]:
        "요약과 대조하는 보고서 검토: { $model }에 최대 { $calls }회 호출.",
    };
    expect(Object.keys(approved).sort()).toEqual(
      Object.values(REPORT_COST_L10N).sort(),
    );
    for (const [id, text] of Object.entries(approved)) {
      expect(entry(id), id).toBe(text);
    }
    // Every argument the model hands the window for these ids is placed.
    const model = asPreflight(
      preflight({ estimate: reportEstimate(), disclosure: reportDisclosure() }),
    );
    const placed = [...model.notices, ...model.selected.lines].filter((l) =>
      Object.keys(approved).includes(l.id),
    );
    expect(new Set(placed.map((l) => l.id)).size).toBe(4);
    for (const line of placed) {
      for (const arg of Object.keys(line.args ?? {})) {
        expect(entry(line.id), `${line.id} $${arg}`).toContain(`{ $${arg} }`);
      }
    }
  });
});

// ===========================================================================
// P6-T15 — an audio run's two moments in the same dialog (plan/09 §0.4 line 13)
// ===========================================================================

const TTS_PRICES: ModelPrices = {
  ...PRICES,
  inputPerMTokUsd: 0.5,
  outputPerMTokUsd: 10,
};

/** Fifty 18-character sentences: two chunks, SYNTHETIC text. */
const AUDIO_SCRIPT = Array.from(
  { length: 50 },
  () => "Tides rise slowly.",
).join(" ");

function audioPlan(prices: ModelPrices | null = TTS_PRICES): AudioPlan {
  return estimateAudioPlan({
    reportId: "r-1",
    script: { text: AUDIO_SCRIPT, language: "en" },
    chunks: chunkScript(AUDIO_SCRIPT, { language: "en" }),
    model: "mock-tts",
    voice: "Charon",
    stylePrefix: "Read this aloud.",
    prices: prices ?? undefined,
    atEpochMs: Date.UTC(2026, 10, 17),
  });
}

function audioDisclosure(scriptDue = true): EgressDisclosure {
  return audioEgressNotice(
    {
      privacyMode: "balanced",
      ttsModelId: "mock-tts",
      scriptCall: scriptDue
        ? { providerId: "openrouter", modelId: "mock-report" }
        : undefined,
      keyFingerprint: "0123456789abcdef",
      knownKeyFingerprints: ["0123456789abcdef"],
    },
    {
      baseUrls: {
        effectiveHost: (id) =>
          id === "gemini"
            ? "generativelanguage.googleapis.com"
            : "openrouter.ai",
      },
      egressAcknowledged: () => true,
      geminiPaidTier: () => false,
    },
  );
}

const SCRIPT_STEP: ScriptStepEstimate = {
  script: {
    modelId: "mock-report",
    calls: 2,
    inputTokens: 9_000,
    outputTokens: 6_000,
    costUsd: 0.117,
    pricesAsOfEpochMs: Date.UTC(2026, 8, 8),
  },
  tts: {
    provisional: true,
    usd: 0.1741,
    inputTokens: 2_800,
    outputTokens: 17_250,
    rateMeasuredOnModel: true,
    totalChars: 8_991,
    chunks: 10,
    estimatedSeconds: 600,
    estimatedBytes: 28_800_044,
    mode: "linked",
  },
  calls: 12,
  costUsd: 0.2911,
};

function audioCommon(
  overrides: Partial<
    Omit<AudioPlanDialogInput, "step" | "plan" | "warnings">
  > = {},
) {
  return {
    disclosure: audioDisclosure(),
    providerName: "Google Gemini",
    confirmAboveCents: 200,
    ceiling: undefined,
    session: ZERO_SPEND,
    askTierQuestion: false,
    pricesAsOfEpochMs: Date.UTC(2026, 8, 8),
    ...overrides,
  };
}

const idsOf = (lines: readonly { id: string }[]) => lines.map((l) => l.id);

describe("P6-T15 — the audio step: FR-42's figures from the real script", () => {
  it("shows characters, chunks, duration, size, import-or-link and cost", () => {
    const plan = audioPlan();
    expect(plan.chunks.length).toBe(2);
    const model = buildAudioDialogModel(
      { step: "audio", plan, warnings: [], ...audioCommon() },
      LOCALE,
    );
    expect(model.mode).toBe("preflight");
    expect(model.selected.lines).toEqual([
      { id: COST_DIALOG_L10N.calls, args: { calls: 2 } },
      {
        id: AUDIO_COST_L10N.length,
        args: { chars: formatCount(plan.totalChars, LOCALE), chunks: 2 },
      },
      {
        id: AUDIO_COST_L10N.duration,
        args: {
          duration: formatMinutes(plan.estimatedSeconds, LOCALE),
          size: formatMegabytes(plan.estimatedBytes, LOCALE),
        },
      },
      { id: AUDIO_COST_L10N.attach, args: { mode: "imported" } },
      {
        id: COST_DIALOG_L10N.total,
        args: { cost: formatUsd(plan.cost.usd ?? -1, LOCALE) },
      },
      { id: AUDIO_COST_L10N.rateUnmeasured },
    ]);
    expect(model.header).toEqual([
      {
        id: COST_DIALOG_L10N.destination,
        args: {
          provider: "Google Gemini",
          host: "generativelanguage.googleapis.com",
          model: "mock-tts",
          mode: "balanced",
        },
      },
    ]);
    expect(model.downgrade).toBeUndefined();
    expect(model.dontAskAgain).toBeUndefined();
    expect(model.tierQuestion).toBeUndefined();
    expect(model.selected.acknowledge).toBeUndefined();
    expect(idsOf(model.footer)).toEqual([
      COST_DIALOG_L10N.usageSession,
      COST_DIALOG_L10N.disclaimer,
    ]);
  });

  it("formats a duration in whole minutes (at least one) and a size in decimal MB", () => {
    expect(formatMinutes(600, LOCALE)).toBe("10 minutes");
    expect(formatMinutes(20, LOCALE)).toBe("1 minute");
    expect(formatMinutes(89, LOCALE)).toBe("1 minute");
    expect(formatMinutes(91, LOCALE)).toBe("2 minutes");
    expect(formatMegabytes(28_800_044, LOCALE)).toBe("28.8 MB");
    expect(formatMegabytes(144_044, LOCALE)).toBe("0.1 MB");
  });

  it("names a linked file, each length warning, and the unmeasured rate only when so", () => {
    const plan = { ...audioPlan(), mode: "linked" as const };
    const measured = {
      ...plan,
      cost: { ...plan.cost, rateMeasuredOnModel: true },
    };
    const model = buildAudioDialogModel(
      {
        step: "audio",
        plan: measured,
        warnings: [
          {
            kind: "length-out-of-band",
            length: { unit: "words", count: 2_400, target: 1_500 },
          },
          {
            kind: "length-out-of-band",
            length: { unit: "hangul-syllables", count: 1_234, target: 3_300 },
          },
        ],
        ...audioCommon(),
      },
      LOCALE,
    );
    const lines = model.selected.lines;
    expect(lines.find((l) => l.id === AUDIO_COST_L10N.attach)?.args).toEqual({
      mode: "linked",
    });
    expect(
      lines
        .filter((l) => l.id === AUDIO_COST_L10N.lengthWarning)
        .map((l) => l.args),
    ).toEqual([
      { unit: "words", count: "2,400", target: "1,500" },
      { unit: "syllables", count: "1,234", target: "3,300" },
    ]);
    expect(idsOf(lines)).not.toContain(AUDIO_COST_L10N.rateUnmeasured);
  });

  it("an unknown TTS price names the model and needs the second acknowledgement", () => {
    const model = buildAudioDialogModel(
      { step: "audio", plan: audioPlan(null), warnings: [], ...audioCommon() },
      LOCALE,
    );
    expect(model.selected.lines).toContainEqual({
      id: COST_DIALOG_L10N.unpriced,
      args: { model: "mock-tts" },
    });
    expect(model.selected.acknowledge).toEqual({
      id: COST_DIALOG_L10N.acknowledgeUnpriced,
    });
    expect(decideCostDialog(model, { accepted: true })).toEqual({
      kind: "cancelled",
    });
    expect(
      decideCostDialog(model, { accepted: true, acknowledged: true }),
    ).toEqual({
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: false,
    });
  });

  it("above the threshold: the threshold line, the acknowledgement, and the ceiling's raise", () => {
    const plan = audioPlan();
    const cost = plan.cost.usd ?? 0;
    expect(cost).toBeGreaterThan(0);
    const model = buildAudioDialogModel(
      {
        step: "audio",
        plan,
        warnings: [],
        ...audioCommon({ confirmAboveCents: 0, ceiling: STOP }),
      },
      LOCALE,
    );
    expect(idsOf(model.selected.lines)).toContain(
      COST_DIALOG_L10N.aboveThreshold,
    );
    expect(model.selected.acknowledge).toEqual({
      id: COST_DIALOG_L10N.acknowledge,
      args: { cost: formatUsd(cost, LOCALE) },
    });
    expect(model.selected.raise?.limitUsd).toBe(0.13);
    expect(
      decideCostDialog(model, { accepted: true, acknowledged: true }),
    ).toMatchObject({ kind: "run", raise: { ceiling: "run", limitUsd: 0.13 } });
  });

  it("the window script's accept rule applies to the audio model unchanged", () => {
    const code = readFileSync(
      resolve(process.cwd(), "addon/content/costConfirm.js"),
      "utf8",
    );
    const factory = new Function(`${code}\nreturn RHCostDialog;`) as () => {
      logic: {
        canAccept(model: unknown, downgrade: boolean, ack: boolean): boolean;
      };
    };
    const { logic } = factory();
    const unpriced = buildAudioDialogModel(
      { step: "audio", plan: audioPlan(null), warnings: [], ...audioCommon() },
      LOCALE,
    );
    expect(logic.canAccept(unpriced, false, false)).toBe(false);
    expect(logic.canAccept(unpriced, false, true)).toBe(true);
  });
});

describe("P6-T15 — the script step: the script call, then the TTS part as provisional", () => {
  it("prices both parts and says the audio is confirmed again with the real script", () => {
    const model = buildAudioDialogModel(
      {
        step: "script",
        estimate: SCRIPT_STEP,
        targetMinutes: 10,
        ...audioCommon(),
      },
      LOCALE,
    );
    expect(model.selected.lines).toEqual([
      { id: COST_DIALOG_L10N.calls, args: { calls: 12 } },
      {
        id: AUDIO_COST_L10N.script,
        args: { calls: 2, model: "mock-report", minutes: "10 minutes" },
      },
      {
        id: AUDIO_COST_L10N.provisional,
        args: { model: "mock-tts", duration: "10 minutes" },
      },
      {
        id: COST_DIALOG_L10N.total,
        args: { cost: formatUsd(0.2911, LOCALE) },
      },
    ]);
    expect(model.notices[0]?.args).toMatchObject({
      script: "due",
      scriptHost: "openrouter.ai",
      ttsHost: "generativelanguage.googleapis.com",
    });
  });

  it("an unknown price on either part names that part's model", () => {
    const both = buildAudioDialogModel(
      {
        step: "script",
        estimate: {
          ...SCRIPT_STEP,
          script: { ...SCRIPT_STEP.script, costUsd: undefined },
          tts: { ...SCRIPT_STEP.tts, usd: undefined },
          costUsd: undefined,
        },
        targetMinutes: 10,
        ...audioCommon(),
      },
      LOCALE,
    );
    expect(
      both.selected.lines.filter((l) => l.id === COST_DIALOG_L10N.unpriced),
    ).toEqual([
      { id: COST_DIALOG_L10N.unpriced, args: { model: "mock-report" } },
      { id: COST_DIALOG_L10N.unpriced, args: { model: "mock-tts" } },
    ]);
    const ttsOnly = buildAudioDialogModel(
      {
        step: "script",
        estimate: {
          ...SCRIPT_STEP,
          tts: { ...SCRIPT_STEP.tts, usd: undefined },
          costUsd: undefined,
        },
        targetMinutes: 10,
        ...audioCommon(),
      },
      LOCALE,
    );
    expect(
      ttsOnly.selected.lines.filter((l) => l.id === COST_DIALOG_L10N.unpriced),
    ).toEqual([{ id: COST_DIALOG_L10N.unpriced, args: { model: "mock-tts" } }]);
  });

  it("carries the tier question when asked: three choices, 'don't know' pre-selected", () => {
    const model = buildAudioDialogModel(
      {
        step: "script",
        estimate: SCRIPT_STEP,
        targetMinutes: 10,
        ...audioCommon({ askTierQuestion: true }),
      },
      LOCALE,
    );
    expect(model.tierQuestion).toEqual({
      prompt: { id: AUDIO_COST_L10N.tierQuestion },
      choices: [
        { answer: "paid", label: { id: AUDIO_COST_L10N.tierPaid } },
        { answer: "free", label: { id: AUDIO_COST_L10N.tierFree } },
        { answer: "unknown", label: { id: AUDIO_COST_L10N.tierUnknown } },
      ],
      preselected: "unknown",
    });
    expect(
      decideCostDialog(model, { accepted: true, tierAnswer: "paid" }),
    ).toEqual({
      kind: "run",
      plan: "selected",
      raise: undefined,
      dontAskAgain: false,
      tierAnswer: "paid",
    });
  });

  it("the window script sends the chosen tier, else the pre-selected one, and nothing without a question (P6-T17)", () => {
    const code = readFileSync(
      resolve(process.cwd(), "addon/content/costConfirm.js"),
      "utf8",
    );
    const factory = new Function(`${code}\nreturn RHCostDialog;`) as () => {
      logic: {
        tierAnswerFor(model: unknown, selected: unknown): string | undefined;
      };
    };
    const { logic } = factory();
    const asked = buildAudioDialogModel(
      {
        step: "script",
        estimate: SCRIPT_STEP,
        targetMinutes: 10,
        ...audioCommon({ askTierQuestion: true }),
      },
      LOCALE,
    );
    expect(logic.tierAnswerFor(asked, "paid")).toBe("paid");
    expect(logic.tierAnswerFor(asked, "free")).toBe("free");
    expect(logic.tierAnswerFor(asked, "unknown")).toBe("unknown");
    // Nothing picked, or a value the question does not offer: the pre-selected.
    expect(logic.tierAnswerFor(asked, undefined)).toBe("unknown");
    expect(logic.tierAnswerFor(asked, "")).toBe("unknown");
    expect(logic.tierAnswerFor(asked, "gold")).toBe("unknown");
    // What the window sends is what decideCostDialog takes.
    expect(
      decideCostDialog(asked, {
        accepted: true,
        tierAnswer: logic.tierAnswerFor(asked, "free") as "free",
      }),
    ).toMatchObject({ kind: "run", tierAnswer: "free" });
    // No question: no answer, whatever the radio group holds.
    const plain = buildAudioDialogModel(
      {
        step: "script",
        estimate: SCRIPT_STEP,
        targetMinutes: 10,
        ...audioCommon(),
      },
      LOCALE,
    );
    expect(logic.tierAnswerFor(plain, "paid")).toBeUndefined();
    expect(
      logic.tierAnswerFor(asPreflight(preflight()), "paid"),
    ).toBeUndefined();
    expect(logic.tierAnswerFor(undefined, "paid")).toBeUndefined();
    expect(code).not.toMatch(/Zotero\.Prefs|Zotero\.HTTP|fetch\(/);
  });

  it("no other model carries a tier question, and no answer reports one", () => {
    const model = asPreflight(preflight());
    expect(model).not.toHaveProperty("tierQuestion");
    expect(
      decideCostDialog(model, { accepted: true, tierAnswer: "paid" }),
    ).not.toHaveProperty("tierAnswer");
  });
});

describe("P6-T15 — the audio strings in both bundles", () => {
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");
  const enUS = read("addon/locale/en-US/research-helper-mainWindow.ftl");
  const koKR = read("addon/locale/ko-KR/research-helper-mainWindow.ftl");
  const audioIds: readonly string[] = [
    ...Object.values(AUDIO_COST_L10N),
    L10N_AUDIO_TIER_REFUSED,
  ];
  const entry = (id: string) => {
    const start = enUS.indexOf(`\n${id} =`);
    const next = enUS.slice(start + 1).search(/\n[a-z][a-z0-9-]* =/);
    return enUS.slice(start, start + 1 + next);
  };

  it("declares each in en-US and leaves each a commented ko-KR stub with a draft (G-41)", () => {
    for (const id of audioIds) {
      expect(enUS, id).toMatch(new RegExp(`^${id} =`, "m"));
      expect(koKR, id).not.toMatch(new RegExp(`^${id} =`, "m"));
      expect(koKR, id).toMatch(new RegExp(`^# ${id} =`, "m"));
    }
  });

  it("every argument the audio models hand the window is placed by its message", () => {
    const models = [
      buildAudioDialogModel(
        {
          step: "script",
          estimate: SCRIPT_STEP,
          targetMinutes: 10,
          ...audioCommon(),
        },
        LOCALE,
      ),
      buildAudioDialogModel(
        {
          step: "audio",
          plan: audioPlan(),
          warnings: [
            {
              kind: "length-out-of-band",
              length: { unit: "words", count: 1, target: 2 },
            },
          ],
          ...audioCommon({ disclosure: audioDisclosure(false) }),
        },
        LOCALE,
      ),
    ];
    const placed = models
      .flatMap((m) => [...m.notices, ...m.selected.lines])
      .filter((l) => audioIds.includes(l.id));
    expect(new Set(placed.map((l) => l.id)).size).toBe(8);
    for (const line of placed) {
      for (const arg of Object.keys(line.args ?? {})) {
        expect(entry(line.id), `${line.id} $${arg}`).toContain(`$${arg}`);
      }
    }
    expect(entry(AUDIO_COST_L10N.notice)).toMatch(/\[due\][\s\S]*\*\[stored\]/);
    expect(entry(AUDIO_COST_L10N.attach)).toMatch(
      /\[linked\][\s\S]*\*\[imported\]/,
    );
    expect(entry(AUDIO_COST_L10N.lengthWarning)).toMatch(
      /\[syllables\][\s\S]*\*\[words\]/,
    );
  });

  it("the notice names both destinations and what the TTS host receives (docs/09 §3 row 5)", () => {
    const body = entry(AUDIO_COST_L10N.notice);
    expect(body).toContain("{ $scriptHost }");
    expect(body.split("{ $ttsHost }")).toHaveLength(3);
    expect(body).toContain("which can name the collection and cited authors");
  });
});

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
  estimateRun,
  type EstimateItem,
  type RunEstimate,
} from "../../../src/pipeline/shared/estimate";
import { estTokens } from "../../../src/llm/shared/tokenEstimate";
import type { ModelPrices } from "../../../src/llm/shared/pricing";
import {
  COST_DIALOG_L10N,
  COST_DIALOG_URL,
  USAGE_L10N,
  buildCostDialogModel,
  createUsageHost,
  decideCostDialog,
  formatUsd,
  openCostConfirmDialog,
  shouldOpenCostDialog,
  skippedNoticeLine,
  usageReadout,
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

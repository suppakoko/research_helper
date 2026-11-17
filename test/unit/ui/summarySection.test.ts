/**
 * `P3-T28`: the item-pane AI summary section's pure parts and its hooks,
 * driven with fake props — no Zotero, no DOM, no network, no LLM call. The
 * DOM half (what a body actually shows, and that markup in a summary stays
 * text) is `test/integration/zotero/summarySection.spec.ts`'s.
 *
 * Every summary below is SYNTHETIC.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_SUMMARIZE_DEBOUNCE_MS,
  GIST_MAX_CHARS,
  REGENERATE_BUTTON,
  SAVE_NOTE_BUTTON,
  SUMMARY_BODY_XHTML,
  SUMMARY_PANE_ID,
  SUMMARY_SECTION_ICON,
  SUMMARY_SECTION_L10N,
  SUMMARY_SECTION_PARTS,
  deriveState,
  SUMMARY_RESULT_L10N,
  ARGUMENT_FREE_FAILURE_IDS,
  SummaryFailedError,
  SummaryNotStoredError,
  failureText,
  summaryFailure,
  mayAutoSummarize,
  notStoredReason,
  paintBody,
  sectionView,
  showsFor,
  summaryInvalidationObserver,
  summarySectionOptions,
  summaryView,
  truncateGist,
  type SectionItem,
  type SummaryGenerateRun,
  type SummarySectionHost,
  type ViewCapabilities,
} from "../../../src/ui/panes/summarySection";
import {
  deriveTldr,
  type PaperSummary,
  type StoredSummary,
} from "../../../src/model/summary";

/* ------------------------------------------------------------- fixtures */

function payload(overrides: Partial<PaperSummary> = {}): PaperSummary {
  return {
    schemaVersion: "paper-summary-v1",
    itemKey: "ABCD1234",
    sourceTier: "abstract",
    confidence: "medium",
    researchQuestion:
      "Does a synthetic intervention change a synthetic outcome? More text.",
    studyDesign: { label: "other", detail: null },
    population: { kind: "not_applicable", description: null, size: null },
    methods: [],
    keyFindings: [
      {
        statement: "The synthetic intervention changed the synthetic outcome.",
        direction: "positive",
        evidenceStrength: "moderate",
        verbatimSupport: null,
      },
    ],
    effectSizes: [],
    limitations: ["A synthetic limitation."],
    novelty: null,
    keywords: [],
    researchTheme: "synthetic theme",
    citationWorthiness: { score: 0.5, reason: "synthetic" },
    ...overrides,
  };
}

function stored(content: PaperSummary = payload()): StoredSummary {
  return {
    id: "doi:10.0000/synthetic:1.0.0:model-x",
    workKey: "doi:10.0000/synthetic",
    zoteroItemKey: "ABCD1234",
    content,
    inputScope: { kind: "abstract" },
    promptId: "PAPER_SUMMARY_ABSTRACT",
    promptVersion: "1.0.0",
    providerId: "openrouter",
    modelId: "synthetic/model-x",
    temperature: 0,
    usage: undefined,
    generatedAtEpochMs: Date.UTC(2026, 9, 29, 12, 0, 0),
    sourceItemVersion: undefined,
    contentHash: "0".repeat(64),
    truncated: false,
    groundingScore: undefined,
    warnings: [],
    redaction: { partlyRedacted: false, redactedStrings: 0, droppedFields: 0 },
  };
}

function item(id: number, regular = true): SectionItem {
  return { id, isRegularItem: () => regular } as unknown as SectionItem;
}

const CAPS: ViewCapabilities = {
  canGenerate: true,
  canSaveNote: true,
  configured: true,
  locale: "en-US",
};

/* ----------------------------------------------------------- pure parts */

describe("summarySection — which items show the section (docs/08 §3.2, first row)", () => {
  it("shows for a regular item and hides for a note, an attachment, an annotation or nothing", () => {
    expect(showsFor(item(1))).toBe(true);
    expect(showsFor(item(2, false))).toBe(false);
    expect(showsFor(undefined)).toBe(false);
    expect(showsFor(null)).toBe(false);
    const broken = {
      id: 3,
      isRegularItem: () => {
        throw new Error("unloaded");
      },
    } as unknown as SectionItem;
    expect(showsFor(broken)).toBe(false);
  });
});

describe("summarySection — the collapsed header's gist (docs/08 §3.2, ~60 chars)", () => {
  it("leaves a short gist alone and collapses its whitespace", () => {
    expect(truncateGist("  a   short\n gist ")).toBe("a short gist");
  });

  it("cuts a long gist at a word break inside the limit, with an ellipsis", () => {
    const long =
      "The synthetic intervention changed the synthetic outcome in every synthetic arm";
    const cut = truncateGist(long);
    expect(cut.length).toBeLessThanOrEqual(GIST_MAX_CHARS);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(cut.slice(0, -1).endsWith(" ")).toBe(false);
  });

  it("never leaves half a surrogate pair", () => {
    const text = `${"x".repeat(GIST_MAX_CHARS - 2)}😀😀😀`;
    const cut = truncateGist(text);
    const last = cut.slice(0, -1);
    const code = last.charCodeAt(last.length - 1);
    expect(code >= 0xd800 && code <= 0xdbff).toBe(false);
  });
});

describe("summarySection — a stored summary as text", () => {
  it("draws the research question, the findings, the limitations, the model and the time", () => {
    const view = summaryView(stored(), "en-US");
    expect(view.researchQuestion).toBe(payload().researchQuestion);
    expect(view.keyFindings).toEqual([
      "The synthetic intervention changed the synthetic outcome.",
    ]);
    expect(view.limitations).toEqual(["A synthetic limitation."]);
    expect(view.meta.startsWith("synthetic/model-x · ")).toBe(true);
    expect(view.meta).toContain("2026");
  });

  it("keeps markup in model output as the same characters, for textContent", () => {
    const markup = '<img src=x onerror="alert(1)"><b>bold</b>';
    const view = summaryView(
      stored(payload({ researchQuestion: markup, limitations: [markup] })),
      "en-US",
    );
    expect(view.researchQuestion).toBe(markup);
    expect(view.limitations).toEqual([markup]);
  });

  it("drops empty findings and limitations rather than drawing blank rows", () => {
    const view = summaryView(
      stored(
        payload({
          keyFindings: [
            {
              statement: "   ",
              direction: "descriptive",
              evidenceStrength: "unclear",
              verbatimSupport: null,
            },
          ],
          limitations: ["", " "],
          researchQuestion: null,
        }),
      ),
      "en-US",
    );
    expect(view.keyFindings).toEqual([]);
    expect(view.limitations).toEqual([]);
    expect(view.researchQuestion).toBe("");
  });
});

describe("summarySection — the seven states as data (docs/08 §3.2)", () => {
  it("derives loading before error before blank before content", () => {
    const row = stored();
    const base = {
      loaded: true,
      stored: row,
      running: false,
      error: undefined,
      configured: true,
    };
    expect(deriveState({ ...base, running: true }).kind).toBe("loading");
    expect(deriveState({ ...base, error: { code: "LLM" } }).kind).toBe("error");
    expect(deriveState({ ...base, loaded: false }).kind).toBe("blank");
    expect(deriveState(base).kind).toBe("content");
    expect(deriveState({ ...base, stored: undefined }).kind).toBe("empty");
    expect(
      deriveState({ ...base, stored: undefined, configured: false }).kind,
    ).toBe("no-key");
    // A stored summary shows whether or not a key is present.
    expect(deriveState({ ...base, configured: false }).kind).toBe("content");
  });

  it("no key: the line and Generate shown but disabled", () => {
    const view = sectionView(
      { kind: "no-key" },
      { ...CAPS, configured: false },
    );
    expect(view.noKey).toBe(true);
    expect(view.generate).toEqual({ hidden: false, disabled: true });
    expect(view.regenerate.disabled).toBe(true);
  });

  it("no key and no Generate bound: Generate is still shown, disabled", () => {
    const view = sectionView(
      { kind: "no-key" },
      { ...CAPS, configured: false, canGenerate: false },
    );
    expect(view.generate).toEqual({ hidden: false, disabled: true });
  });

  it("empty: Generate enabled when bound, hidden when not — never a dead button", () => {
    expect(sectionView({ kind: "empty" }, CAPS).generate).toEqual({
      hidden: false,
      disabled: false,
    });
    const unbound = sectionView(
      { kind: "empty" },
      { ...CAPS, canGenerate: false },
    );
    expect(unbound.generate.hidden).toBe(true);
    expect(unbound.regenerate.hidden).toBe(true);
    expect(unbound.retry.hidden).toBe(true);
  });

  it("content: the gist is deriveTldr truncated, Save as note enabled", () => {
    const row = stored();
    const view = sectionView({ kind: "content", stored: row }, CAPS);
    expect(view.gist).toBe(truncateGist(deriveTldr(row.content)));
    expect(view.saveNote).toEqual({ hidden: false, disabled: false });
    expect(view.regenerate).toEqual({ hidden: false, disabled: false });
    expect(view.generate.hidden).toBe(true);
    expect(view.content).toBeDefined();
  });

  it("loading: both header buttons disabled", () => {
    const view = sectionView({ kind: "loading" }, CAPS);
    expect(view.loading).toBe(true);
    expect(view.regenerate.disabled).toBe(true);
    expect(view.saveNote.disabled).toBe(true);
  });

  it("error: the machine values and Retry", () => {
    const view = sectionView(
      { kind: "error", failure: { code: "RATE_LIMIT · HTTP 429" } },
      CAPS,
    );
    expect(view.errorFailure).toEqual({ code: "RATE_LIMIT · HTTP 429" });
    expect(view.retry).toEqual({ hidden: false, disabled: false });
    expect(view.gist).toBe("");
  });

  it("hides Save as note while no note writer is bound", () => {
    const view = sectionView(
      { kind: "content", stored: stored() },
      { ...CAPS, canSaveNote: false },
    );
    expect(view.saveNote.hidden).toBe(true);
  });

  it("redacts a key-shaped string from a failure's message, for the log", () => {
    const planted = `sk-or-v1-${"a".repeat(40)}`;
    const text = failureText(new Error(`provider said ${planted}`));
    expect(text).not.toContain(planted);
    expect(text).toContain("[redacted:");
    expect(failureText("plain")).toBe("plain");
    expect(failureText(42)).toBe("");
  });
});

describe("summarySection — autoSummarize (docs/07 §8.5 ships it off)", () => {
  const base = {
    autoSummarize: true,
    configured: true,
    canGenerate: true,
    running: false,
    triedBefore: false,
  };

  it("never starts with autoSummarize off", () => {
    expect(mayAutoSummarize({ ...base, autoSummarize: false })).toBe(false);
  });

  it("starts only with a key, a bound Generate, nothing running and no earlier try", () => {
    expect(mayAutoSummarize(base)).toBe(true);
    expect(mayAutoSummarize({ ...base, configured: false })).toBe(false);
    expect(mayAutoSummarize({ ...base, canGenerate: false })).toBe(false);
    expect(mayAutoSummarize({ ...base, running: true })).toBe(false);
    expect(mayAutoSummarize({ ...base, triedBefore: true })).toBe(false);
  });
});

/* ----------------------------------------------------- the notifier observer */

describe("summarySection — the delete/trash observer (docs/07 §9.3 trigger 3)", () => {
  function observer(keys: Record<number, string | undefined>) {
    const tags: string[] = [];
    const errors: string[] = [];
    const notify = summaryInvalidationObserver({
      workKeyOf: (id) => keys[id],
      invalidateByTag: (tag) => {
        tags.push(tag);
        return Promise.resolve(1);
      },
      onError: (message) => {
        errors.push(message);
      },
    });
    return { notify, tags, errors };
  }

  it("invalidates each trashed item's work tag once, escaped as the summary cache writes it", async () => {
    const { notify, tags } = observer({
      1: "doi:10.1/a,b%c",
      2: "pmid:7",
      3: "pmid:7",
    });
    await notify("trash", "item", [1, 2, 3], {});
    expect(tags).toEqual(["work:doi:10.1/a%2Cb%25c", "work:pmid:7"]);
  });

  it("invalidates on delete when the item still resolves, and skips one that does not", async () => {
    const { notify, tags } = observer({ 4: "arxiv:2401.00001" });
    await notify("delete", "item", [4, 5], {});
    expect(tags).toEqual(["work:arxiv:2401.00001"]);
  });

  it("ignores every other event and type", async () => {
    const { notify, tags } = observer({ 1: "pmid:1" });
    await notify("modify", "item", [1], {});
    await notify("add", "item", [1], {});
    await notify("trash", "collection", [1], {});
    expect(tags).toEqual([]);
  });

  it("reports a failed invalidation instead of throwing into Zotero's notifier", async () => {
    const errors: string[] = [];
    const notify = summaryInvalidationObserver({
      workKeyOf: () => "pmid:1",
      invalidateByTag: () => Promise.reject(new Error("closed")),
      onError: (message) => {
        errors.push(message);
      },
    });
    await expect(notify("trash", "item", [1], {})).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- the hooks */

interface Recorded {
  readonly summaries: string[];
  readonly buttons: { type: string; status: unknown }[];
  enabled: boolean | undefined;
}

/** A body no DOM backs: every `querySelector` finds nothing. */
function fakeBody(): HTMLDivElement {
  return {
    querySelector: () => null,
    ownerDocument: {},
  } as unknown as HTMLDivElement;
}

function props(body: HTMLDivElement, target: SectionItem, rec: Recorded) {
  return {
    paneID: SUMMARY_PANE_ID,
    doc: {} as Document,
    body,
    item: target,
    tabType: "library",
    editable: true,
    setL10nArgs: () => undefined,
    setEnabled: (enabled: boolean) => {
      rec.enabled = enabled;
      return !enabled;
    },
    setSectionSummary: (summary: string) => {
      rec.summaries.push(summary);
      return summary;
    },
    setSectionButtonStatus: (type: string, status: unknown) => {
      rec.buttons.push({ type, status });
    },
  } as unknown as _ZoteroTypes.ItemPaneManagerSection.SectionHookArgs;
}

function newRecorded(): Recorded {
  return { summaries: [], buttons: [], enabled: undefined };
}

function fakeHost(overrides: Partial<SummarySectionHost> = {}) {
  const calls = { load: 0, generate: [] as boolean[] };
  const host: SummarySectionHost = {
    isConfigured: () => true,
    autoSummarize: () => false,
    load: () => {
      calls.load += 1;
      return Promise.resolve(undefined);
    },
    generate: (_item, options): SummaryGenerateRun => {
      calls.generate.push(options.regenerate);
      return { done: Promise.resolve(), cancel: () => undefined };
    },
    saveAsNote: () => Promise.resolve(),
    onError: () => undefined,
    locale: () => "en-US",
    ...overrides,
  };
  return { host, calls };
}

describe("summarySection — the registration options (docs/08 §3.1, §3.3)", () => {
  it("carries the pane id, the plugin id, both required icons and the four l10n ids", () => {
    const { host } = fakeHost();
    const options = summarySectionOptions("plugin@example.invalid", host);
    expect(options.paneID).toBe(SUMMARY_PANE_ID);
    expect(options.pluginID).toBe("plugin@example.invalid");
    expect(options.header).toEqual({
      l10nID: SUMMARY_SECTION_L10N.header,
      icon: SUMMARY_SECTION_ICON,
    });
    expect(options.sidenav).toEqual({
      l10nID: SUMMARY_SECTION_L10N.sidenav,
      icon: SUMMARY_SECTION_ICON,
    });
    expect(options.sectionButtons?.map((button) => button.type)).toEqual([
      REGENERATE_BUTTON,
      SAVE_NOTE_BUTTON,
    ]);
    for (const button of options.sectionButtons ?? []) {
      expect(button.type).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(button.icon).toBe(SUMMARY_SECTION_ICON);
    }
  });

  it("puts no script and no placeholder for model output into the static body", () => {
    expect(SUMMARY_BODY_XHTML).not.toMatch(/<script/i);
    // Classes, not ids: the section is drawn twice in one document.
    expect(SUMMARY_BODY_XHTML).not.toMatch(/\sid=/);
    for (const id of [
      SUMMARY_SECTION_L10N.empty,
      SUMMARY_SECTION_L10N.generate,
      SUMMARY_SECTION_L10N.noKey,
      SUMMARY_SECTION_L10N.openPreferences,
      SUMMARY_SECTION_L10N.loading,
      SUMMARY_SECTION_L10N.cancel,
      SUMMARY_SECTION_L10N.failed,
      SUMMARY_SECTION_L10N.retry,
    ]) {
      expect(SUMMARY_BODY_XHTML).toContain(`data-l10n-id="${id}"`);
    }
  });
});

describe("summarySection — the hooks, with fake props", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the section for a non-regular item through setEnabled, and returns the same answer", () => {
    const { host } = fakeHost();
    const options = summarySectionOptions("p", host);
    const rec = newRecorded();
    const body = fakeBody();
    const shown = options.onItemChange?.(props(body, item(1, false), rec));
    expect(rec.enabled).toBe(false);
    expect(shown as unknown).toBe(false);
    options.onItemChange?.(props(body, item(2), rec));
    expect(rec.enabled).toBe(true);
  });

  it("does no I/O in onRender, and reads the table in onAsyncRender", async () => {
    const row = stored();
    const { host, calls } = fakeHost({
      load: () => {
        calls.load += 1;
        return Promise.resolve(row);
      },
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onRender?.(props(body, item(1), rec));
    expect(calls.load).toBe(0);
    expect(rec.summaries).toEqual([""]);
    await options.onAsyncRender?.(props(body, item(1), rec));
    expect(calls.load).toBe(1);
    expect(rec.summaries.at(-1)).toBe(truncateGist(deriveTldr(row.content)));
    // The next sync render paints the known row without reading again.
    options.onRender?.(props(body, item(1), rec));
    expect(calls.load).toBe(1);
    expect(rec.summaries.at(-1)).toBe(truncateGist(deriveTldr(row.content)));
  });

  it("issues zero Generate calls across twenty selections with autoSummarize off", async () => {
    const { host, calls } = fakeHost();
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    for (let id = 1; id <= 20; id += 1) {
      options.onItemChange?.(props(body, item(id), rec));
      options.onRender?.(props(body, item(id), rec));
      await options.onAsyncRender?.(props(body, item(id), rec));
    }
    await vi.advanceTimersByTimeAsync(AUTO_SUMMARIZE_DEBOUNCE_MS * 10);
    expect(calls.load).toBe(20);
    expect(calls.generate).toEqual([]);
  });

  it("with autoSummarize on, debounces and starts one run, for the item still selected", async () => {
    const { host, calls } = fakeHost({ autoSummarize: () => true });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    for (let id = 1; id <= 5; id += 1) {
      options.onRender?.(props(body, item(id), rec));
      await options.onAsyncRender?.(props(body, item(id), rec));
      await vi.advanceTimersByTimeAsync(AUTO_SUMMARIZE_DEBOUNCE_MS / 4);
    }
    expect(calls.generate).toEqual([]);
    await vi.advanceTimersByTimeAsync(AUTO_SUMMARIZE_DEBOUNCE_MS);
    expect(calls.generate).toEqual([false]);
  });

  it("never starts a run without a key, whatever autoSummarize says", async () => {
    const { host, calls } = fakeHost({
      autoSummarize: () => true,
      isConfigured: () => false,
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onRender?.(props(body, item(1), rec));
    await options.onAsyncRender?.(props(body, item(1), rec));
    await vi.advanceTimersByTimeAsync(AUTO_SUMMARIZE_DEBOUNCE_MS * 4);
    const regenerate = options.sectionButtons?.[0];
    regenerate?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    expect(calls.generate).toEqual([]);
  });

  it("only Regenerate asks for the bypass; Retry and Generate keep the cache rule (plan/00 §6 item 305(c))", async () => {
    const seen: { regenerate: boolean; bypassCache?: boolean }[] = [];
    const { host } = fakeHost({
      generate: (_item, options) => {
        seen.push({ ...options });
        return { done: Promise.resolve(), cancel: () => undefined };
      },
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onInit?.({
      ...props(body, item(1), rec),
      refresh: () => Promise.resolve(),
    } as never);
    options.onRender?.(props(body, item(1), rec));
    options.sectionButtons?.[0]?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([{ regenerate: true, bypassCache: true }]);

    // Retry and Generate, through the body's own buttons: no bypass.
    const listeners = new Map<string, () => void>();
    const button = (name: string) =>
      new Proxy(
        {
          addEventListener: (_type: string, listener: () => void) => {
            listeners.set(name, listener);
          },
        } as Record<string, unknown>,
        {
          get: (target, key) =>
            key in target ? target[key as string] : () => undefined,
          set: () => true,
        },
      );
    const wired = {
      querySelector: (selector: string) =>
        selector === `.${SUMMARY_SECTION_PARTS.retry}`
          ? button("retry")
          : selector === `.${SUMMARY_SECTION_PARTS.generate}`
            ? button("generate")
            : null,
      ownerDocument: {},
    } as unknown as HTMLDivElement;
    options.onInit?.({
      ...props(wired, item(2), rec),
      refresh: () => Promise.resolve(),
    } as never);
    options.onRender?.(props(wired, item(2), rec));
    seen.length = 0;
    listeners.get("retry")?.();
    await vi.advanceTimersByTimeAsync(0);
    listeners.get("generate")?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([{ regenerate: true }, { regenerate: false }]);
  });

  it("Regenerate starts a run with regenerate: true and refreshes through the captured refresh", async () => {
    const { host, calls } = fakeHost();
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    const refresh = vi.fn(() => Promise.resolve());
    options.onInit?.({ ...props(body, item(1), rec), refresh } as never);
    options.onRender?.(props(body, item(1), rec));
    const regenerate = options.sectionButtons?.[0];
    regenerate?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    expect(calls.generate).toEqual([true]);
    expect(refresh).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    // Done: refreshed again, and the next render reads the table afresh.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows a failed run as an error for that item, and forgets it on another item", async () => {
    const errors: unknown[] = [];
    const { host } = fakeHost({
      generate: () => ({
        done: Promise.reject(new Error("HTTP 429")),
        cancel: () => undefined,
      }),
      onError: (_message, error) => {
        errors.push(error);
      },
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onInit?.({
      ...props(body, item(1), rec),
      refresh: () => Promise.resolve(),
    } as never);
    options.onRender?.(props(body, item(1), rec));
    options.sectionButtons?.[0]?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    rec.buttons.length = 0;
    options.onRender?.(props(body, item(1), rec));
    // Error state: Regenerate enabled again (not busy).
    expect(
      rec.buttons.find((b) => b.type === REGENERATE_BUTTON)?.status,
    ).toEqual({
      hidden: false,
      disabled: false,
    });
  });

  it("Save as note is called only for the stored row of the item shown", async () => {
    const row = stored();
    const saved: StoredSummary[] = [];
    const { host } = fakeHost({
      load: () => Promise.resolve(row),
      saveAsNote: (_item, value) => {
        saved.push(value);
        return Promise.resolve();
      },
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    const save = options.sectionButtons?.[1];
    save?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    expect(saved).toEqual([]);
    options.onRender?.(props(body, item(1), rec));
    await options.onAsyncRender?.(props(body, item(1), rec));
    save?.onClick({
      ...props(body, item(2), rec),
      event: {} as Event,
    } as never);
    expect(saved).toEqual([]);
    save?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    expect(saved).toEqual([row]);
  });

  it("starts one run at a time: a second Regenerate while running does nothing", () => {
    const { host, calls } = fakeHost({
      generate: (_item, options) => {
        calls.generate.push(options.regenerate);
        return {
          done: new Promise<void>(() => undefined),
          cancel: () => undefined,
        };
      },
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onRender?.(props(body, item(1), rec));
    const click = () =>
      options.sectionButtons?.[0]?.onClick({
        ...props(body, item(1), rec),
        event: {} as Event,
      } as never);
    click();
    click();
    expect(calls.generate).toEqual([true]);
  });

  it("drops a read that finishes after the selection moved on", async () => {
    let resolveLoad: ((row: StoredSummary) => void) | undefined;
    const { host } = fakeHost({
      load: () =>
        new Promise<StoredSummary | undefined>((resolve) => {
          resolveLoad = resolve;
        }),
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onRender?.(props(body, item(1), rec));
    const pending = options.onAsyncRender?.(props(body, item(1), rec));
    options.onRender?.(props(body, item(2), rec));
    resolveLoad?.(stored());
    await pending;
    expect(rec.summaries.every((line) => line === "")).toBe(true);
    options.onRender?.(props(body, item(1), rec));
    expect(rec.summaries.at(-1)).toBe("");
  });

  it("onDestroy cancels a run in flight and drops the body's state", () => {
    const cancel = vi.fn();
    const { host } = fakeHost({
      generate: () => ({ done: new Promise<void>(() => undefined), cancel }),
    });
    const options = summarySectionOptions("p", host);
    const body = fakeBody();
    const rec = newRecorded();
    options.onRender?.(props(body, item(1), rec));
    options.sectionButtons?.[0]?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    options.onDestroy?.({ paneID: SUMMARY_PANE_ID, doc: {} as Document, body });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------- item 303: the run's result in the banner */

describe("summarySection — what the banner shows for a one-item run (plan/00 §6 item 303(a))", () => {
  it("reads the message of an error made in another global, which fails instanceof Error", () => {
    const planted = `sk-or-v1-${"0".repeat(40)}`;
    const foreign: unknown = runInNewContext(
      `new Error("HTTP 429 from provider ${planted}")`,
    );
    expect(foreign instanceof Error).toBe(false);
    const text = failureText(foreign);
    expect(text).toContain("HTTP 429 from provider");
    expect(text).not.toContain(planted);
    expect(text).toContain("[redacted:");
    expect(failureText({ message: "plain object" })).toBe("plain object");
    expect(failureText({ message: 7 })).toBe("");
    expect(failureText(null)).toBe("");
  });

  it("recognizes a run that stored nothing by its shape, and nothing else", () => {
    expect(notStoredReason(new SummaryNotStoredError("no-key"))).toBe("no-key");
    expect(
      notStoredReason({ name: "SummaryNotStoredError", reason: "existing" }),
    ).toBe("existing");
    expect(
      notStoredReason({ name: "SummaryNotStoredError", reason: "bogus" }),
    ).toBeUndefined();
    expect(notStoredReason(new Error("no-key"))).toBeUndefined();
    expect(notStoredReason(undefined)).toBeUndefined();
  });

  it("carries the reason to the view, and keeps Retry", () => {
    const view = sectionView(
      { kind: "error", failure: { code: "" }, reason: "no-text" },
      CAPS,
    );
    expect(view.errorReason).toBe("no-text");
    expect(view.retry).toEqual({ hidden: false, disabled: false });
    expect(
      deriveState({
        loaded: true,
        stored: undefined,
        running: false,
        error: { code: "LLM" },
        reason: "time-limit",
        configured: true,
      }),
    ).toEqual({
      kind: "error",
      failure: { code: "LLM" },
      reason: "time-limit",
    });
  });

  it("paints a reason or an argument-free message by id, and the code as machine values", () => {
    const attributes = new Map<string, string>();
    const element = (into: Map<string, string> | undefined) => ({
      hidden: false,
      textContent: "old",
      setAttribute: (name: string, value: string) => {
        into?.set(name, value);
      },
      removeAttribute: (name: string) => {
        into?.delete(name);
      },
    });
    const errorText = element(attributes);
    const errorCode = element(undefined);
    const body = {
      ownerDocument: null,
      querySelector: (selector: string) =>
        selector === ".rh-summary-error-text"
          ? errorText
          : selector === ".rh-summary-error-code"
            ? errorCode
            : null,
    } as unknown as HTMLElement;
    paintBody(
      body,
      sectionView(
        { kind: "error", failure: { code: "LLM" }, reason: "existing" },
        CAPS,
      ),
    );
    expect(errorCode.textContent).toBe("");
    expect(errorCode.hidden).toBe(true);
    expect(errorText.textContent).toBe("");
    expect(attributes.get("data-l10n-id")).toBe(
      SUMMARY_RESULT_L10N.notSummarized,
    );
    expect(JSON.parse(attributes.get("data-l10n-args") ?? "{}")).toEqual({
      reason: "existing",
    });
    paintBody(
      body,
      sectionView({ kind: "error", failure: { code: "LLM · HTTP 503" } }, CAPS),
    );
    expect(errorText.textContent).toBe("");
    expect(attributes.size).toBe(0);
    expect(errorCode.textContent).toBe("LLM · HTTP 503");
    expect(errorCode.hidden).toBe(false);
    paintBody(
      body,
      sectionView(
        {
          kind: "error",
          failure: { code: "OFFLINE", messageId: "rh-error-offline" },
        },
        CAPS,
      ),
    );
    expect(errorText.textContent).toBe("");
    expect(attributes.get("data-l10n-id")).toBe("rh-error-offline");
    expect(attributes.has("data-l10n-args")).toBe(false);
    expect(errorCode.textContent).toBe("OFFLINE");
  });

  it("never draws a failure's detail or message: machine values only (P7-T03 step 5, items 389(f), 392(a))", () => {
    const planted =
      "the provider said: model overloaded, see https://status.example";
    // As runItemSummary throws a failed run, from the whole SerializedError:
    // its detail is not carried, not even in the message.
    const serialized = {
      code: "UPSTREAM",
      messageKey: "rh-error-llm",
      detail: planted,
      retryable: true,
      httpStatus: 503,
    };
    const thrown = new SummaryFailedError(serialized);
    expect(Object.values(thrown).join(" ")).not.toContain("provider said");
    expect(thrown.message).not.toContain("provider said");
    expect(thrown.message).toBe("[research-helper] summary failed (UPSTREAM)");
    expect(String(thrown.stack ?? "")).not.toContain("provider said");
    expect(summaryFailure(thrown)).toEqual({ code: "UPSTREAM · HTTP 503" });
    // Any other error-shaped value: the message and detail are never read.
    const foreign = {
      message: planted,
      detail: planted,
      code: "LLM",
      messageKey: "rh-error-offline",
    };
    const failure = summaryFailure(foreign);
    expect(failure).toEqual({ code: "LLM", messageId: "rh-error-offline" });
    expect(JSON.stringify(failure)).not.toContain("provider said");
    expect(summaryFailure(new Error(planted))).toEqual({ code: "" });
    expect(summaryFailure(planted)).toEqual({ code: "" });
    expect(summaryFailure(null)).toEqual({ code: "" });
    // A code or status that is not machine-shaped is dropped, not shown.
    expect(summaryFailure({ code: planted, httpStatus: 503 })).toEqual({
      code: "",
    });
    expect(summaryFailure({ code: "LLM", httpStatus: "503" })).toEqual({
      code: "LLM",
    });
    expect(summaryFailure({ code: "LLM", httpStatus: 42 })).toEqual({
      code: "LLM",
    });
    expect(summaryFailure({ code: "LLM", httpStatus: 600 })).toEqual({
      code: "LLM",
    });
    expect(summaryFailure({ code: "LLM", httpStatus: 100 })).toEqual({
      code: "LLM · HTTP 100",
    });
    expect(summaryFailure({ code: "LLM", httpStatus: 599 })).toEqual({
      code: "LLM · HTTP 599",
    });
    expect(summaryFailure({ code: "LLM", httpStatus: 502.5 })).toEqual({
      code: "LLM",
    });
    expect(summaryFailure({ code: "Llm" })).toEqual({ code: "" });
    expect(summaryFailure({ code: "LLM2_X" })).toEqual({ code: "LLM2_X" });
    // A message id that takes arguments is not drawn by id.
    expect(summaryFailure({ code: "LLM", messageKey: "rh-error-llm" })).toEqual(
      { code: "LLM" },
    );
  });

  it("lists as argument-free only error messages that take no argument in either bundle", () => {
    const read = (locale: string): string =>
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          `../../../addon/locale/${locale}/research-helper-mainWindow.ftl`,
        ),
        "utf8",
      );
    for (const locale of ["en-US", "ko-KR"]) {
      const ftl = read(locale);
      for (const id of ARGUMENT_FREE_FAILURE_IDS) {
        const at = ftl.search(new RegExp(`^${id} =`, "mu"));
        expect(at, `${locale} ${id}`).toBeGreaterThanOrEqual(0);
        const rest = ftl.slice(at).split(/\n(?=[a-z#\n])/u)[0] ?? "";
        expect(rest, `${locale} ${id}`).not.toContain("{");
      }
    }
    expect(ARGUMENT_FREE_FAILURE_IDS.length).toBeGreaterThan(0);
  });

  it("a hook run that stored nothing shows its reason for that item", async () => {
    const attributes = new Map<string, string>();
    const errorText = {
      hidden: false,
      textContent: "",
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
      removeAttribute: (name: string) => {
        attributes.delete(name);
      },
    };
    const body = {
      ownerDocument: {},
      querySelector: (selector: string) =>
        selector === ".rh-summary-error-text" ? errorText : null,
    } as unknown as HTMLDivElement;
    const { host } = fakeHost({
      generate: () => ({
        done: Promise.reject(new SummaryNotStoredError("retracted")),
        cancel: () => undefined,
      }),
    });
    const options = summarySectionOptions("p", host);
    const rec = newRecorded();
    options.onInit?.({
      ...props(body, item(1), rec),
      refresh: () => Promise.resolve(),
    } as never);
    options.onRender?.(props(body, item(1), rec));
    options.sectionButtons?.[0]?.onClick({
      ...props(body, item(1), rec),
      event: {} as Event,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    options.onRender?.(props(body, item(1), rec));
    expect(attributes.get("data-l10n-id")).toBe(
      SUMMARY_RESULT_L10N.notSummarized,
    );
    expect(attributes.get("data-l10n-args")).toBe(
      JSON.stringify({ reason: "retracted" }),
    );
  });
});

/**
 * `plan/09` `P6-T07` — the audio script pass (`writeScript` and its helpers in
 * `src/pipeline/audioReport/script.ts`, `citationMapFor` in `citationMap.ts`),
 * layer 1: plain Node, a fake router and a fake citation port, no network and
 * no spend. The prompts are the shipped files, read from disk; the good answer
 * is `P6-T03`'s `audio-script-en` stand-in until `P6-T04` records it.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  ContentFilterError,
  OperationCancelledError,
  OutputTruncatedError,
} from "../../../src/core/errors";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import type {
  BudgetGuard,
  ChatRequest,
  ChatResponse,
  LLMCallContext,
  ModelPurpose,
} from "../../../src/llm/types";
import type { TrendReport } from "../../../src/model/trend";
import {
  citationMapFor,
  inertSurname,
  spokenAttribution,
  type CitationAuthorRecord,
  type CitationSource,
} from "../../../src/pipeline/audioReport/citationMap";
import {
  buildScriptInputs,
  chooseScriptSource,
  correctionNote,
  countSpokenWords,
  isSameRun,
  reportMarkdownFor,
  reportTargetWordsOf,
  resolveAudioLanguage,
  resolveTargetMinutes,
  SCRIPT_RETRY_HEADER,
  scriptLengthOf,
  scriptOutputCeiling,
  validateScript,
  writeScript,
  type ScriptDeps,
  type ScriptInput,
} from "../../../src/pipeline/audioReport/script";
import {
  createPromptRegistry,
  PROMPT_FILE_NAMES,
  PROMPT_IDS,
} from "../../../src/prompts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const REGISTRY = createPromptRegistry(
  PROMPT_IDS.map((id) => ({
    fileName: PROMPT_FILE_NAMES[id],
    text: readFileSync(
      resolve(repo, "src/prompts", PROMPT_FILE_NAMES[id]),
      "utf8",
    ),
  })),
);
const PROMPTS = {
  en: REGISTRY.get("AUDIO_SCRIPT_EN"),
  ko: REGISTRY.get("AUDIO_SCRIPT_KO"),
} as const;

/** `P6-T03`'s stand-in answer for `audio-script-en`. */
const STAND_IN: string = (() => {
  const file = JSON.parse(
    readFileSync(
      resolve(repo, "test/fixtures/llm/openrouter/audio-script-en.json"),
      "utf8",
    ),
  ) as { body: string };
  const body = JSON.parse(file.body) as {
    choices: { message: { content: string } }[];
  };
  return body.choices[0]?.message.content ?? "";
})();

/** `P6-T03`'s stand-in answer for `audio-script-ko` (357 Hangul syllables, no digits). */
const STAND_IN_KO: string = (() => {
  const file = JSON.parse(
    readFileSync(
      resolve(repo, "test/fixtures/llm/openrouter/audio-script-ko.json"),
      "utf8",
    ),
  ) as { body: string };
  const body = JSON.parse(file.body) as {
    choices: { message: { content: string } }[];
  };
  return body.choices[0]?.message.content ?? "";
})();

const KEYS = ["KEY00001", "KEY00002", "KEY00003", "KEY00004", "KEY00005"];
const BIBLIOGRAPHY_LINE =
  "[1] Doe J. A study of everything. J Examples. 2024. doi:10.1000/xyz";

function report(overrides: Partial<TrendReport> = {}): TrendReport {
  const sections: TrendReport["sections"] = [
    {
      number: 1,
      heading: "1. Executive Summary",
      markdown: `- Tide gauges sink [[${KEYS[0] ?? ""}]] [[${KEYS[1] ?? ""}]].`,
      citedItemKeys: [KEYS[0] ?? "", KEYS[1] ?? ""],
    },
    {
      number: 4,
      heading: "4. Major Research Themes",
      markdown: `Corrections differ [[${KEYS[2] ?? ""}]], [[${KEYS[3] ?? ""}]] and [[${KEYS[0] ?? ""}]].`,
      citedItemKeys: [KEYS[2] ?? "", KEYS[3] ?? "", KEYS[0] ?? ""],
    },
    {
      number: 10,
      heading: "10. Notable Papers",
      markdown: `| Paper | Why |\n| --- | --- |\n| [[${KEYS[4] ?? ""}]] | first |`,
      citedItemKeys: [KEYS[4] ?? ""],
    },
    {
      number: 11,
      heading: "11. Bibliography",
      markdown: `${BIBLIOGRAPHY_LINE}\n\nRetracted — not used in this report\n\n- Roe R. Withdrawn. 2021.`,
      citedItemKeys: [],
    },
  ];
  return {
    id: "report-en-1",
    libraryID: 1,
    collectionKey: "COLL0001",
    collectionName: "Coastal sea level",
    title: "Research Trends: Coastal sea level (2026-11-17)",
    language: "en",
    generatedAtEpochMs: Date.UTC(2026, 10, 17),
    pluginVersion: "0.0.2",
    scope: {
      totalCount: 6,
      analysedCount: 5,
      excludedCount: 1,
      fullTextCount: 2,
      abstractCount: 3,
      yearMin: 2019,
      yearMax: 2025,
    },
    reductionPasses: 0,
    sections,
    clustering: { themes: [], assignments: [] },
    bibliography: [],
    retracted: [],
    excluded: [],
    summaryIds: [],
    qualityProxies: {
      citationDensity: undefined,
      coverageRatio: 1,
      brokenCitationCount: 0,
      meanGroundingScore: undefined,
      contradictionCount: 0,
      unresolvedHighSeverityCount: 0,
    },
    critique: { rounds: 0, unresolved: [], revisedAfterLastCritique: false },
    markdown: `# whole report\n\n${BIBLIOGRAPHY_LINE}`,
    audioScripts: {},
    providerId: "openrouter",
    prompts: [],
    usage: undefined,
    ...overrides,
  } as TrendReport;
}

function records(): Map<string, CitationAuthorRecord> {
  const rows: CitationAuthorRecord[] = [
    {
      itemKey: "KEY00001",
      firstAuthorSurname: "Testa",
      authorCount: 3,
      year: 2025,
    },
    {
      itemKey: "KEY00002",
      firstAuthorSurname: "Sample",
      authorCount: 1,
      year: 2023,
    },
    {
      itemKey: "KEY00003",
      firstAuthorSurname: "Exemplo",
      authorCount: 2,
      year: undefined,
    },
    {
      itemKey: "KEY00004",
      firstAuthorSurname: "Kim",
      authorCount: 4,
      year: 2024,
    },
    {
      itemKey: "KEY00005",
      firstAuthorSurname: "Lee",
      authorCount: 2,
      year: 2022,
    },
  ];
  return new Map(rows.map((r) => [r.itemKey, r]));
}

function citationSource(
  map: Map<string, CitationAuthorRecord> = records(),
): CitationSource & {
  calls: { libraryID: number; keys: readonly string[] }[];
} {
  const calls: { libraryID: number; keys: readonly string[] }[] = [];
  return {
    calls,
    readCitations(libraryID, keys) {
      calls.push({ libraryID, keys });
      return Promise.resolve(
        new Map([...map].filter(([key]) => keys.includes(key))),
      );
    },
  };
}

interface LogLine {
  readonly level: string;
  readonly msg: string;
  readonly ctx: Record<string, unknown> | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    child: () => logger,
    error: (msg, ctx) => lines.push({ level: "error", msg, ctx }),
    warn: (msg, ctx) => lines.push({ level: "warn", msg, ctx }),
    info: (msg, ctx) => lines.push({ level: "info", msg, ctx }),
    debug: (msg, ctx) => lines.push({ level: "debug", msg, ctx }),
    time: (_msg, fn) => fn(),
  };
  return logger;
}

function answer(
  text: string,
  finishReason: ChatResponse["finishReason"] = "stop",
): ChatResponse {
  return {
    text,
    json: undefined,
    model: "vendor/strong-model",
    finishReason,
    usage: {
      inputTokens: 900,
      outputTokens: 400,
      totalTokens: 1300,
      costUsd: 0.001,
    },
    servedBy: undefined,
    latencyMs: 1,
    raw: undefined,
  };
}

const BUDGET = { kind: "test-budget" } as unknown as BudgetGuard;

function harness(answers: ChatResponse[], extra: Partial<ScriptDeps> = {}) {
  const requests: ChatRequest[] = [];
  const contexts: LLMCallContext[] = [];
  const purposes: ModelPurpose[] = [];
  const lines: LogLine[] = [];
  const queue = [...answers];
  const citations = citationSource();
  const deps: ScriptDeps = {
    llm: {
      resolveModel(purpose) {
        purposes.push(purpose);
        return {
          providerId: "openrouter",
          modelId: "vendor/strong-model",
          fromPref: "reportModel",
        };
      },
      chat(request, ctx) {
        requests.push(request);
        contexts.push(ctx);
        const next = queue.shift();
        if (next === undefined) throw new Error("no answer left");
        return Promise.resolve(next);
      },
    },
    budget: BUDGET,
    token: createCancellationTokenSource().token,
    prompts: PROMPTS,
    citations,
    logger: recordingLogger(lines),
    ...extra,
  };
  return { deps, requests, contexts, purposes, lines, citations };
}

function input(overrides: Partial<ScriptInput> = {}): ScriptInput {
  return { report: report(), language: "en", targetMinutes: 1, ...overrides };
}

// ---------------------------------------------------------------------------
// Inputs: the citation map and REPORT_MARKDOWN (Done when, line 1)
// ---------------------------------------------------------------------------

describe("the script call's inputs (plan/09 §0.4 line 15)", () => {
  it("a report citing five keys gives a five-line map and a REPORT_MARKDOWN with no bibliography line", async () => {
    const h = harness([answer(STAND_IN)]);
    const done = await writeScript(input(), h.deps);
    expect(done.kind).toBe("written");
    const user = h.requests[0]?.messages[1]?.content ?? "";
    expect(h.citations.calls).toEqual([{ libraryID: 1, keys: KEYS }]);
    const mapBlock = user.slice(
      user.indexOf("CITATION MAP"),
      user.indexOf("REPORT (untrusted)"),
    );
    expect(mapBlock.match(/→/gu)?.length).toBe(5);
    expect(mapBlock).toContain('KEY00001 → "Testa and colleagues, 2025"');
    expect(mapBlock).toContain('KEY00002 → "Sample, 2023"');
    expect(mapBlock).toContain('KEY00003 → "Exemplo and colleagues"');
    expect(user).not.toContain(BIBLIOGRAPHY_LINE);
    expect(user).not.toContain("11. Bibliography");
    expect(user).not.toContain("Retracted");
    expect(user).toContain("## 1. Executive Summary");
    expect(user).toContain("## 10. Notable Papers");
    expect(user).toContain("COLLECTION: Coastal sea level");
    expect(user).toContain("5 papers, 2019 to 2025.");
    expect(user).toContain("Target length: about 1 minutes.");
  });

  it("buildScriptInputs fills all seven variables; a missing year reads n.d.; the target must be 1–60", () => {
    const r = report({
      scope: { ...report().scope, yearMin: undefined, yearMax: undefined },
    });
    const built = buildScriptInputs(r, 10, "MAP");
    expect(Object.keys(built.variables).sort()).toEqual(
      [...PROMPTS.en.variables].sort(),
    );
    expect(built.variables.TARGET_MINUTES).toBe("10");
    expect(built.variables.YEAR_MIN).toBe("n.d.");
    expect(built.variables.YEAR_MAX).toBe("n.d.");
    expect(built.variables.CITATION_MAP).toBe("MAP");
    expect(built.citedItemKeys).toEqual(KEYS);
    expect(built.variables.REPORT_MARKDOWN).toBe(reportMarkdownFor(r));
    for (const bad of [0, 61, 2.5]) {
      expect(() => buildScriptInputs(r, bad, "")).toThrow(RangeError);
    }
  });

  it("citationMapFor: an unreadable item and an item with no surname map to nothing and are logged by key only", async () => {
    const map = records();
    map.delete("KEY00004");
    map.set("KEY00005", {
      itemKey: "KEY00005",
      firstAuthorSurname: "  \n ",
      authorCount: 1,
      year: 2020,
    });
    const lines: LogLine[] = [];
    const out = await citationMapFor(
      7,
      [...KEYS, "KEY00001"],
      citationSource(map),
      recordingLogger(lines),
    );
    expect(out.lines).toBe(3);
    expect(out.unmapped).toEqual(["KEY00004", "KEY00005"]);
    expect(lines.map((l) => l.ctx?.itemKey)).toEqual(["KEY00004", "KEY00005"]);
    expect(JSON.stringify(lines)).not.toMatch(/Kim|Lee/u);
    const crossed = records();
    crossed.set("KEY00002", {
      itemKey: "KEY00009",
      firstAuthorSurname: "Wrong",
      authorCount: 1,
      year: 2001,
    });
    const crossedOut = await citationMapFor(
      7,
      ["KEY00002"],
      citationSource(crossed),
    );
    expect(crossedOut.unmapped).toEqual(["KEY00002"]);
    expect(crossedOut.text).not.toContain("Wrong");
    expect(await citationMapFor(7, [], citationSource())).toEqual({
      text: "",
      lines: 0,
      unmapped: [],
    });
  });

  it("a surname is made inert before it is sent", () => {
    expect(inertSurname('O"Brien\n[[X]] | **#`')).toBe("OBrien X");
    expect(inertSurname("Ga\u0301bor")).toBe("Gábor");
    expect(inertSurname("x".repeat(100))?.length).toBe(80);
    expect(inertSurname("Le" + "\u0007" + "e")).toBe("Le e");
    expect(inertSurname("Le" + "\u0085" + "e")).toBe("Le e");
    expect(inertSurname("→")).toBeUndefined();
    expect(
      spokenAttribution({
        itemKey: "K",
        firstAuthorSurname: "김",
        authorCount: 1,
        year: undefined,
      }),
    ).toBe("김");
  });
});

// ---------------------------------------------------------------------------
// Validation and the one retry (Done when, line 2)
// ---------------------------------------------------------------------------

describe("validateScript and the one retry (docs/04 §8.5, docs/12 §13)", () => {
  it("a first answer with ## and [12] triggers exactly one retry naming both; a second leak returns ScriptRejected", async () => {
    const leaky = "## Findings\nThe effect held [12]. More text follows.";
    const h = harness([answer(leaky), answer("Still a table | row.")]);
    const out = await writeScript(input(), h.deps);
    expect(h.requests).toHaveLength(2);
    const first = h.requests[0]?.messages[1]?.content ?? "";
    const retry = h.requests[1]?.messages[1]?.content ?? "";
    expect(first).not.toContain(SCRIPT_RETRY_HEADER);
    expect(retry.startsWith(first)).toBe(true);
    expect(retry).toContain(SCRIPT_RETRY_HEADER);
    expect(retry).toContain('a Markdown heading or "##" survived');
    expect(retry).toContain("a bracket citation such as [12] survived");
    expect(retry).not.toContain("The effect held");
    expect(h.requests[1]?.messages[0]).toEqual(h.requests[0]?.messages[0]);
    expect(out.kind).toBe("script-rejected");
    if (out.kind !== "script-rejected") return;
    expect(out.leaks).toEqual(["pipe"]);
    expect(out.text).toBe("Still a table | row.");
    expect(out.calls).toBe(2);
    expect(out.reportId).toBe("report-en-1");
    expect(out.usage?.inputTokens).toBe(1800);
    expect(JSON.stringify(h.lines)).not.toContain("Still a table");
  });

  it("a leak fixed by the retry returns the retried script", async () => {
    const h = harness([answer("See https://x.org now."), answer(STAND_IN)]);
    const out = await writeScript(input(), h.deps);
    expect(h.requests).toHaveLength(2);
    expect(out.kind).toBe("written");
    if (out.kind !== "written") return;
    expect(out.calls).toBe(2);
    expect(out.script.text).toBe(STAND_IN.trim());
    expect(out.script.usage?.outputTokens).toBe(800);
  });

  it.each([
    ["citation-marker", "Kim found it [[KEY00001]]."],
    ["heading", "# Title\nText."],
    ["heading", "Text with ## inside."],
    ["bullet", "Intro.\n- a point"],
    ["pipe", "a | b"],
    ["bold", "a **bold** claim"],
    ["bold", "an __under__ claim"],
    ["bracket-citation", "as shown [3, 7]."],
    ["backtick", "the `code` part"],
    ["url", "see http://example.org"],
    ["doi", "see 10.1000/abc"],
    ["et-al", "Kim et al. found it."],
  ] as const)("%s is caught: %j", (id, text) => {
    expect(validateScript(text)).toContain(id);
  });

  it("the stand-in script passes, an empty answer does not, and the retry note lists leaks in order", () => {
    expect(validateScript(STAND_IN)).toEqual([]);
    expect(validateScript("  \n ")).toEqual(["empty"]);
    expect(
      validateScript("a plain sentence, with commas; and colons: fine."),
    ).toEqual([]);
    expect(correctionNote(["heading", "url"]).split("\n")).toEqual([
      SCRIPT_RETRY_HEADER,
      '- a Markdown heading or "##" survived',
      "- a URL survived",
    ]);
  });

  it("a cut-off answer is OutputTruncatedError and is not retried", async () => {
    const h = harness([answer("Half a scr", "length"), answer(STAND_IN)]);
    await expect(writeScript(input(), h.deps)).rejects.toBeInstanceOf(
      OutputTruncatedError,
    );
    expect(h.requests).toHaveLength(1);
  });

  it("a filtered answer is ContentFilterError and is not retried", async () => {
    const h = harness([answer("", "content_filter"), answer(STAND_IN)]);
    await expect(writeScript(input(), h.deps)).rejects.toBeInstanceOf(
      ContentFilterError,
    );
    expect(h.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TARGET_MINUTES and the ceiling (Done when, line 3)
// ---------------------------------------------------------------------------

describe("TARGET_MINUTES (docs/04 §12 item 1) and the output ceiling (§0.4 line 23)", () => {
  it("0 with a 3,000-word target gives 10; the clamp holds at 1 and 60; a set preference wins", () => {
    expect(resolveTargetMinutes(0, 3000)).toBe(10);
    expect(resolveTargetMinutes(0, 100)).toBe(1);
    expect(resolveTargetMinutes(0, 0)).toBe(1);
    expect(resolveTargetMinutes(0, 449)).toBe(1);
    expect(resolveTargetMinutes(0, 450)).toBe(2);
    expect(resolveTargetMinutes(0, 18_000)).toBe(60);
    expect(resolveTargetMinutes(0, 90_000)).toBe(60);
    expect(resolveTargetMinutes(7, 3000)).toBe(7);
    expect(resolveTargetMinutes(60, 3000)).toBe(60);
    for (const bad of [-1, 61, 1.5, Number.NaN]) {
      expect(() => resolveTargetMinutes(bad, 3000)).toThrow(RangeError);
    }
  });

  it("the report's target is what its run resolved: automatic by paper count, a stored value as stored", () => {
    // 5 analysed papers fall in docs/06 §9.2's first row: 1 500 words.
    expect(reportTargetWordsOf(report(), 0)).toBe(1500);
    expect(resolveTargetMinutes(0, reportTargetWordsOf(report(), 0))).toBe(5);
    expect(reportTargetWordsOf(report(), 3000)).toBe(3000);
    expect(reportTargetWordsOf(report(), 9000)).toBe(4250);
  });

  it("the ceiling is the prompt's floor until the target passes it, then scales", () => {
    expect(scriptOutputCeiling(PROMPTS.en, "en", 1)).toBe(2500);
    expect(scriptOutputCeiling(PROMPTS.en, "en", 10)).toBe(3163);
    expect(scriptOutputCeiling(PROMPTS.en, "en", 60)).toBe(18973);
    expect(scriptOutputCeiling(PROMPTS.ko, "ko", 10)).toBe(3500);
    expect(scriptOutputCeiling(PROMPTS.ko, "ko", 60)).toBe(18386);
  });

  it("the request: the strong model, temperature 0.4, the scaled ceiling, routing, budget and beforeSend passed", async () => {
    let sent = 0;
    const beforeSend = (): Promise<void> => {
      sent += 1;
      return Promise.resolve();
    };
    const routing = { requireNoTraining: true };
    const h = harness([answer(STAND_IN)], {
      beforeSend,
      routing,
      traceId: "job-9",
    });
    await writeScript(input({ targetMinutes: 10 }), h.deps);
    expect(h.purposes).toEqual(["strong"]);
    const request = h.requests[0] as ChatRequest;
    expect(request.model).toBe("vendor/strong-model");
    expect(request.temperature).toBe(0.4);
    expect(request.maxOutputTokens).toBe(3163);
    expect(request.responseFormat).toBeUndefined();
    expect(request.effort).toBeUndefined();
    expect(request.routing).toEqual(routing);
    expect(request.traceId).toBe("job-9:en:script-1");
    expect(request.accounting).toEqual({ promptId: "AUDIO_SCRIPT_EN" });
    expect(request.messages[0]?.content).toBe(PROMPTS.en.system);
    expect(h.contexts[0]?.budget).toBe(BUDGET);
    await h.contexts[0]?.beforeSend?.();
    expect(sent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The written script, and what refuses before a call
// ---------------------------------------------------------------------------

describe("writeScript's result and its refusals", () => {
  it("returns the validated script, not stored, with its length and source language", async () => {
    const r = report();
    const h = harness([answer(`\n${STAND_IN}\n`)]);
    const out = await writeScript(input({ report: r }), h.deps);
    expect(out.kind).toBe("written");
    if (out.kind !== "written") return;
    expect(out.script.reportId).toBe("report-en-1");
    expect(out.script.language).toBe("en");
    expect(out.script.sourceLanguage).toBe("en");
    expect(out.script.text).toBe(STAND_IN.trim());
    expect(out.script.targetMinutes).toBe(1);
    expect(out.script.length).toEqual({
      unit: "words",
      count: countSpokenWords(STAND_IN),
      target: 150,
    });
    expect(out.script.warnings).toEqual([]);
    expect(out.unmappedItemKeys).toEqual([]);
    expect(r.audioScripts).toEqual({});
  });

  it("a script outside ±30 % carries a warning, never a reject", () => {
    const words = (n: number): string => Array(n).fill("word").join(" ");
    expect(scriptLengthOf(words(105), "en", 1).warnings).toEqual([]);
    expect(scriptLengthOf(words(195), "en", 1).warnings).toEqual([]);
    expect(scriptLengthOf(words(104), "en", 1).warnings).toEqual([
      {
        kind: "length-out-of-band",
        length: { unit: "words", count: 104, target: 150 },
      },
    ]);
    expect(scriptLengthOf(words(196), "en", 1).warnings).toHaveLength(1);
    expect(countSpokenWords("one - two, three —  four")).toBe(4);
  });

  it("refuses without a budget, or with the wrong prompt for the language, before any read or call", async () => {
    const noBudget = harness([answer(STAND_IN)], { budget: undefined });
    await expect(writeScript(input(), noBudget.deps)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    const swapped = harness([answer(STAND_IN)], {
      prompts: { en: PROMPTS.ko, ko: PROMPTS.en },
    });
    await expect(writeScript(input(), swapped.deps)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    for (const h of [noBudget, swapped]) {
      expect(h.requests).toHaveLength(0);
      expect(h.citations.calls).toHaveLength(0);
    }
  });

  it("a cancelled job makes no call", async () => {
    const source = createCancellationTokenSource();
    source.cancel({ kind: "user" });
    const h = harness([answer(STAND_IN)], { token: source.token });
    await expect(writeScript(input(), h.deps)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
    expect(h.requests).toHaveLength(0);
  });

  it("holds one pool permit per request and releases it", async () => {
    let held = 0;
    let taken = 0;
    const pool = {
      acquire: () => {
        held += 1;
        taken += 1;
        return Promise.resolve(() => {
          held -= 1;
        });
      },
    };
    const h = harness([answer("## no"), answer(STAND_IN)], { pool });
    await writeScript(input(), h.deps);
    expect(taken).toBe(2);
    expect(held).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P6-T08 — the Korean path: the language, the source, Korean's own length
// ---------------------------------------------------------------------------

/** A `both` run's Korean record: same library, collection and instant. */
function koreanCompanion(overrides: Partial<TrendReport> = {}): TrendReport {
  const en = report();
  return report({
    id: "report-ko-1",
    language: "ko",
    sections: [
      {
        number: 1,
        heading: "1. 요약 (Executive Summary)",
        markdown: "- 조위계는 가라앉습니다 [[KEY00001]].",
        citedItemKeys: ["KEY00001"],
      },
      {
        number: 11,
        heading: "11. 참고문헌 (Bibliography)",
        markdown: BIBLIOGRAPHY_LINE,
        citedItemKeys: [],
      },
    ],
    generatedAtEpochMs: en.generatedAtEpochMs,
    ...overrides,
  });
}

describe("P6-T08: the Korean script path", () => {
  it("an English-only report with ko makes one AUDIO_SCRIPT_KO call over the English sections, sourceLanguage en", async () => {
    const h = harness([answer(STAND_IN_KO)]);
    const out = await writeScript(input({ language: "ko" }), h.deps);
    expect(h.requests).toHaveLength(1);
    const request = h.requests[0] as ChatRequest;
    expect(request.accounting).toEqual({ promptId: "AUDIO_SCRIPT_KO" });
    expect(request.messages[0]?.content).toBe(PROMPTS.ko.system);
    const user = request.messages[1]?.content ?? "";
    expect(user).toContain("컬렉션: Coastal sea level");
    expect(user).toContain("## 1. Executive Summary");
    expect(user).toContain("목표 길이: 약 1분.");
    expect(user).not.toContain(BIBLIOGRAPHY_LINE);
    expect(request.maxOutputTokens).toBe(3500);
    expect(out.kind).toBe("written");
    if (out.kind !== "written") return;
    expect(out.script.language).toBe("ko");
    expect(out.script.sourceLanguage).toBe("en");
    expect(out.script.reportId).toBe("report-en-1");
    expect(out.script.text).toBe(STAND_IN_KO);
    expect(out.script.length).toEqual({
      unit: "hangul-syllables",
      count: 357,
      target: 330,
    });
    expect(out.script.warnings).toEqual([]);
  });

  it("a both run's Korean report is used when present; a record of another run is not", async () => {
    const h = harness([answer(STAND_IN_KO)]);
    const out = await writeScript(
      input({ language: "ko", companion: koreanCompanion() }),
      h.deps,
    );
    const user = h.requests[0]?.messages[1]?.content ?? "";
    expect(user).toContain("## 1. 요약 (Executive Summary)");
    expect(user).not.toContain("## 1. Executive Summary");
    expect(user).not.toContain(BIBLIOGRAPHY_LINE);
    expect(h.citations.calls).toEqual([{ libraryID: 1, keys: ["KEY00001"] }]);
    expect(out.kind === "written" && out.script.sourceLanguage).toBe("ko");
    expect(out.kind === "written" && out.script.reportId).toBe("report-en-1");

    const other = koreanCompanion({ generatedAtEpochMs: 1 });
    expect(chooseScriptSource(report(), "ko", other).id).toBe("report-en-1");
    const otherCollection = koreanCompanion({ collectionKey: "COLL0002" });
    expect(chooseScriptSource(report(), "ko", otherCollection).id).toBe(
      "report-en-1",
    );
    const otherLibrary = koreanCompanion({ libraryID: 2 });
    expect(chooseScriptSource(report(), "ko", otherLibrary).id).toBe(
      "report-en-1",
    );
    // Two records in one language are never one run's pair.
    expect(isSameRun(report(), report())).toBe(false);
    expect(isSameRun(report(), koreanCompanion())).toBe(true);
    // The job's own report wins when it is already in the language asked.
    expect(chooseScriptSource(report(), "en", koreanCompanion()).id).toBe(
      "report-en-1",
    );
    expect(chooseScriptSource(koreanCompanion(), "ko", report()).id).toBe(
      "report-ko-1",
    );
    // An English script from a Korean job uses the run's English record.
    expect(chooseScriptSource(koreanCompanion(), "en", report()).id).toBe(
      "report-en-1",
    );
  });

  it("the language: the window's choice, then tts.language, then the report's own", () => {
    const en = { language: "en" } as const;
    const ko = { language: "ko" } as const;
    expect(resolveAudioLanguage("auto", en)).toBe("en");
    expect(resolveAudioLanguage("auto", ko)).toBe("ko");
    expect(resolveAudioLanguage("ko", en)).toBe("ko");
    expect(resolveAudioLanguage("en", ko)).toBe("en");
    expect(resolveAudioLanguage("en", ko, "ko")).toBe("ko");
    expect(resolveAudioLanguage("ko", en, "en")).toBe("en");
    expect(resolveAudioLanguage("ko", en, "auto")).toBe("ko");
  });

  it("the Korean band counts Hangul syllables, never English words", () => {
    const syllables = (n: number): string => "가".repeat(n);
    expect(scriptLengthOf(syllables(231), "ko", 1).warnings).toEqual([]);
    expect(scriptLengthOf(syllables(429), "ko", 1).warnings).toEqual([]);
    expect(scriptLengthOf(syllables(230), "ko", 1).warnings).toHaveLength(1);
    expect(scriptLengthOf(syllables(430), "ko", 1).warnings).toHaveLength(1);
    // 330 syllables in one "word": the English band would warn, Korean's does not.
    const one = scriptLengthOf(syllables(330), "ko", 1);
    expect(one.length).toEqual({
      unit: "hangul-syllables",
      count: 330,
      target: 330,
    });
    expect(one.warnings).toEqual([]);
    // 150 English words with no Hangul are out of the Korean band.
    const english = Array(150).fill("word").join(" ");
    expect(scriptLengthOf(english, "ko", 1).length.count).toBe(0);
    expect(scriptLengthOf(english, "en", 1).warnings).toEqual([]);
  });

  it("Arabic numerals left in a Korean script are logged with the count, not rejected; none for English", async () => {
    const withDigits = `${STAND_IN_KO} 2024년에 12개 연구가 1,204명을 다뤘습니다.`;
    const h = harness([answer(withDigits)]);
    const out = await writeScript(input({ language: "ko" }), h.deps);
    expect(out.kind).toBe("written");
    expect(h.requests).toHaveLength(1);
    const line = h.lines.find((l) => l.msg.includes("Arabic numerals"));
    expect(line?.level).toBe("info");
    expect(line?.ctx).toEqual({ numerals: 4, sourceLanguage: "en" });
    expect(JSON.stringify(h.lines)).not.toContain("연구가");

    const english = harness([answer(STAND_IN)]);
    await writeScript(input(), english.deps);
    expect(english.lines.some((l) => l.msg.includes("Arabic numerals"))).toBe(
      false,
    );
  });

  it("the same marker rejects apply to a Korean script, and the retry note stays English", async () => {
    const h = harness([answer("## 요약\n본문입니다."), answer(STAND_IN_KO)]);
    const out = await writeScript(input({ language: "ko" }), h.deps);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]?.messages[1]?.content).toContain(SCRIPT_RETRY_HEADER);
    expect(h.requests[1]?.messages[1]?.content).toContain(
      'a Markdown heading or "##" survived',
    );
    expect(out.kind).toBe("written");
  });
});

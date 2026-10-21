/**
 * `P3-T13` step 5: the per-model calibration of `estTokens`
 * (`llm.tokenEstimateCalibration`, `docs/07` §8.5; `docs/03` §10.2 "Correcting
 * the drift"). Every model answer is SYNTHETIC, from `test/helpers/mockLLM.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMemoryPrefStore,
  type PrefStore,
} from "../../../src/core/config";
import { createCancellationTokenSource } from "../../../src/core/jobQueue/cancellation";
import type { Logger } from "../../../src/core/logger";
import {
  CALIBRATION_BLEND,
  calibrationFactor,
  createCalibrationRecorder,
  estTokens,
  foldCalibration,
  parseCalibration,
} from "../../../src/llm/shared/tokenEstimate";
import { PREF_KEYS, setPrefStore } from "../../../src/prefs";
import { chatResponse, mockLLM } from "../../helpers/mockLLM";

const KEY = PREF_KEYS.llmTokenEstimateCalibration;

/** A memory store that counts writes per key. */
function spyingStore(initial: Record<string, string> = {}) {
  const store = createMemoryPrefStore(initial);
  const writes: string[] = [];
  const spying: PrefStore = {
    ...store,
    set(key, value) {
      writes.push(key);
      store.set(key, value);
    },
  };
  setPrefStore(spying);
  return { store, writes };
}

afterEach(() => {
  setPrefStore(undefined);
});

/** 37 Latin characters: exactly 10 tokens raw. */
const TEN_TOKENS = "a".repeat(37);

describe("estTokens with a model ID applies the stored factor", () => {
  it('with the pref stubbed "not json", returns the uncalibrated value without throwing', () => {
    spyingStore({ [KEY]: "not json" });
    expect(() => estTokens(TEN_TOKENS, "m")).not.toThrow();
    expect(estTokens(TEN_TOKENS, "m")).toBe(10);
    expect(calibrationFactor("m")).toBeUndefined();
  });

  it('with {"m": 1.2}, returns 1.2× for model m (before any headroom), and the raw value otherwise', () => {
    spyingStore({ [KEY]: '{"m": 1.2}' });
    expect(estTokens(TEN_TOKENS, "m")).toBe(12);
    expect(estTokens(TEN_TOKENS)).toBe(10);
    expect(estTokens(TEN_TOKENS, "other")).toBe(10);
    expect(estTokens("", "m")).toBe(0);
    // Rounded up once, after the factor: 11 × 1.2 = 13.2 → 14.
    expect(estTokens("a".repeat(38), "m")).toBe(14);
  });

  it("treats anything but a positive finite number as uncalibrated", () => {
    const raw = estTokens(TEN_TOKENS);
    for (const stored of [
      '{"m": 0}',
      '{"m": -1.5}',
      '{"m": "1.2"}',
      '{"m": null}',
      '{"m": [1.2]}',
      "[1.2]",
      "1.2",
      "null",
      "",
    ]) {
      spyingStore({ [KEY]: stored });
      expect(estTokens(TEN_TOKENS, "m"), stored).toBe(raw);
    }
  });

  it("reads the preference again once it changes, and needs no store at all", () => {
    expect(estTokens(TEN_TOKENS, "m")).toBe(10); // no store: the schema default "{}"
    const { store } = spyingStore({ [KEY]: '{"m": 2}' });
    expect(estTokens(TEN_TOKENS, "m")).toBe(20);
    store.set(KEY, '{"m": 3}');
    expect(estTokens(TEN_TOKENS, "m")).toBe(30);
  });

  it("does not see an inherited property as a factor", () => {
    spyingStore({ [KEY]: "{}" });
    expect(calibrationFactor("constructor")).toBeUndefined();
    expect(estTokens(TEN_TOKENS, "toString")).toBe(10);
  });
});

describe("parseCalibration and foldCalibration", () => {
  it("keeps only positive finite entries and never throws", () => {
    expect(parseCalibration('{"a": 1.1, "b": 0, "c": "x", "d": 2}')).toEqual({
      a: 1.1,
      d: 2,
    });
    expect(parseCalibration("{")).toEqual({});
    expect(parseCalibration("[]")).toEqual({});
  });

  it("takes the job's factor for a new model and blends it into a stored one", () => {
    expect(CALIBRATION_BLEND).toBe(0.5);
    const next = foldCalibration(
      { old: 1.0, untouched: 1.3 },
      new Map([
        ["old", { estimatedInputTokens: 100, actualInputTokens: 140 }],
        ["new", { estimatedInputTokens: 200, actualInputTokens: 230 }],
        ["empty", { estimatedInputTokens: 0, actualInputTokens: 10 }],
      ]),
    );
    expect(next.old).toBeCloseTo(1.0 * 0.5 + 1.4 * 0.5, 12);
    expect(next.new).toBeCloseTo(1.15, 12);
    expect(next.untouched).toBe(1.3);
    expect("empty" in next).toBe(false);
  });
});

describe("createCalibrationRecorder — measured in memory, written once per job", () => {
  it("a 10-call scripted job makes exactly one setPref for the calibration row", async () => {
    const { store, writes } = spyingStore({ [KEY]: '{"other-model": 0.9}' });
    // Each answer reports 25 % more input tokens than the raw heuristic gave.
    const provider = mockLLM([
      (call) =>
        chatResponse("{}", {
          usage: {
            inputTokens:
              estTokens(call.request.messages.map((m) => m.content).join("")) *
              1.25,
            outputTokens: 1,
            totalTokens: undefined,
            costUsd: undefined,
          },
        }),
    ]);
    const recorder = createCalibrationRecorder();
    const token = createCancellationTokenSource().token;
    for (let index = 0; index < 10; index++) {
      const text = `Abstract ${index}: ${"sepsis mortality ".repeat(index + 3)}`;
      const response = await provider.chat(
        {
          model: "m",
          messages: [{ role: "user", content: text }],
          traceId: `t${index}`,
        },
        { token },
      );
      recorder.record("m", estTokens(text), response.usage.inputTokens);
    }
    expect(writes).toEqual([]); // nothing per call

    expect(recorder.flush()).toBe(true);
    expect(writes).toEqual([KEY]);
    const stored = JSON.parse(String(store.values.get(KEY))) as Record<
      string,
      number
    >;
    expect(Object.keys(stored)).toEqual(["m", "other-model"]);
    expect(stored.m).toBeCloseTo(1.25, 12);
    expect(stored["other-model"]).toBe(0.9);

    // The next estimate for "m" is calibrated.
    expect(estTokens(TEN_TOKENS, "m")).toBe(Math.ceil(10 * 1.25));
    // Flushing again with nothing new writes nothing.
    expect(recorder.flush()).toBe(false);
    expect(writes).toEqual([KEY]);
  });

  it('parses the stored value inside try/catch at job end: "not json" counts as {}', () => {
    const { store, writes } = spyingStore({ [KEY]: "not json" });
    const recorder = createCalibrationRecorder();
    recorder.record("m", 100, 120);
    expect(recorder.flush()).toBe(true);
    expect(writes).toEqual([KEY]);
    expect(JSON.parse(String(store.values.get(KEY)))).toEqual({ m: 1.2 });
  });

  it("sums a model's calls before dividing, so long calls weigh more", () => {
    const { store } = spyingStore();
    const recorder = createCalibrationRecorder();
    recorder.record("m", 10, 20); // ratio 2 on a short call
    recorder.record("m", 990, 990); // ratio 1 on a long one
    recorder.flush();
    expect(
      (JSON.parse(String(store.values.get(KEY))) as Record<string, number>).m,
    ).toBeCloseTo(1010 / 1000, 12);
  });

  it("ignores calls with no usable counts, and then writes nothing", () => {
    const { writes } = spyingStore();
    const recorder = createCalibrationRecorder();
    recorder.record("m", 100, undefined);
    recorder.record("m", 0, 50);
    recorder.record("m", 100, 0);
    recorder.record("m", Number.NaN, 50);
    recorder.record("", 100, 50);
    expect(recorder.flush()).toBe(false);
    expect(writes).toEqual([]);
  });

  it("logs and reports a failed write instead of throwing, and drops the job's ratios", () => {
    setPrefStore(undefined); // no store: setPref throws ConfigurationError
    const warn = vi.fn();
    const logger = { warn } as unknown as Logger;
    const recorder = createCalibrationRecorder({ logger });
    recorder.record("m", 100, 120);
    expect(() => recorder.flush()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const { writes } = spyingStore();
    expect(recorder.flush()).toBe(false);
    expect(writes).toEqual([]);
  });
});

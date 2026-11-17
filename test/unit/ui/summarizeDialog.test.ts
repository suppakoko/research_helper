/**
 * `P7-T33` (`plan/00` §6 item 393, owner, 2026-11-17): the summarize window says
 * that Zotero is offline, once per run, with the keyword search's own message.
 *
 * The session in `src/bootstrap/registerUI.ts` (`createSummarizeSession`) sets
 * `offline` from {@link isOfflineFailure}; `test/integration/offline.spec.ts`
 * reads the line in the real window.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { OfflineError, NetworkError } from "../../../src/core/errors";
import { MAIN_WINDOW_MESSAGE_IDS } from "../../../src/i18n/keys";
import type { SummarizeRunView } from "../../../src/pipeline/summarize/summarizePipeline";
import {
  SUMMARIZE_DIALOG_L10N,
  SUMMARIZE_OFFLINE_L10N,
  buildSummarizeWindowModel,
  isOfflineFailure,
} from "../../../src/ui/dialogs/summarizeDialog";

const ROOT = resolve(__dirname, "../../..");

function view(fields: Partial<SummarizeRunView> = {}): SummarizeRunView {
  return {
    stage: "done",
    collectionName: "Synthetic",
    total: 10,
    toSummarize: 10,
    settled: 10,
    rows: [],
    counts: {
      fullText: 0,
      abstractOnly: 9,
      noText: 0,
      retracted: 0,
      duplicate: 0,
      language: 0,
      existing: 0,
      cached: 0,
      fresh: 9,
      failed: 1,
      notesWritten: 9,
      notesFailed: 0,
    },
    notesWritable: true,
    ...fields,
  } as SummarizeRunView;
}

describe("P7-T33 — the summarize window's offline line", () => {
  it("reads an OfflineError and a serialized OFFLINE error as offline", () => {
    expect(isOfflineFailure(new OfflineError("offline"))).toBe(true);
    expect(
      isOfflineFailure({
        code: "OFFLINE",
        messageKey: "rh-error-offline",
        detail: "d",
        retryable: true,
      }),
    ).toBe(true);
  });

  it("reads any other error, and anything that is not an error, as not offline", () => {
    expect(isOfflineFailure(new NetworkError("down"))).toBe(false);
    expect(isOfflineFailure({ code: "NETWORK" })).toBe(false);
    expect(isOfflineFailure(new Error("OFFLINE"))).toBe(false);
    expect(isOfflineFailure("OFFLINE")).toBe(false);
    expect(isOfflineFailure(undefined)).toBe(false);
    expect(isOfflineFailure(null)).toBe(false);
  });

  it("draws rh-error-offline once, with no argument, when the host says offline", () => {
    const model = buildSummarizeWindowModel(view(), {
      running: false,
      offline: true,
      outcome: { kind: "succeeded" },
    });
    expect(model.offline).toStrictEqual({ id: "rh-error-offline" });
    expect(SUMMARIZE_OFFLINE_L10N).toBe("rh-error-offline");
    expect(MAIN_WINDOW_MESSAGE_IDS as readonly string[]).toContain(
      "rh-error-offline",
    );
    // The outcome line is unchanged: the offline line is beside it.
    expect(model.outcome?.id).toBe(SUMMARIZE_DIALOG_L10N.outcome);
  });

  it("draws no offline line otherwise", () => {
    for (const offline of [false, undefined]) {
      const model = buildSummarizeWindowModel(view(), {
        running: true,
        ...(offline !== undefined && { offline }),
      });
      expect(model.offline).toBeUndefined();
    }
  });

  it("has a place in the window, hidden until it is drawn", () => {
    const markup = readFileSync(
      resolve(ROOT, "addon/content/summarize.xhtml"),
      "utf8",
    );
    expect(markup).toMatch(
      /<html:p id="rh-summarize-offline" hidden="hidden" \/>/,
    );
    const script = readFileSync(
      resolve(ROOT, "addon/content/summarize.js"),
      "utf8",
    );
    expect(script).toContain('offline: "rh-summarize-offline"');
    expect(script).toContain(
      "this.place(this.el(this.spec.offline), model.offline);",
    );
  });
});

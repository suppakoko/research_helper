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

// ===========================================================================
// P7-T42 (owner, plan/00 §6 item 413(a)): the window redraws only the rows
// that change. Batch J (plan/reports/P7-batchJ.md §2) measured the 500-item
// job's pauses as Gecko's accessibility work on rows that `renderRows` removed
// and recreated, all of them, on every update.
// ===========================================================================

const XHTML = "http://www.w3.org/1999/xhtml";

/** The slice of a DOM node `renderRows` and `render` use. */
class FakeNode {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  hidden = false;
  disabled = false;
  checked = false;
  textContent = "";
  constructor(
    readonly localName: string,
    readonly namespace: string | undefined = undefined,
  ) {}
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    if (!siblings) return null;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode): FakeNode {
    return this.insertBefore(child, null);
  }
  insertBefore(child: FakeNode, reference: FakeNode | null): FakeNode {
    child.remove();
    const at =
      reference === null
        ? this.childNodes.length
        : this.childNodes.indexOf(reference);
    if (at < 0) throw new Error("the reference is not a child");
    this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  remove(): void {
    const parent = this.parentNode;
    if (!parent) return;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(): void {
    /* the window's buttons are not exercised here */
  }
}

interface RowsHarness {
  readonly controller: {
    render(model: unknown): void;
    renderRows(rows: readonly unknown[]): void;
  };
  readonly container: FakeNode;
  /** Every `setAttributes` call, in order. */
  readonly sets: { element: FakeNode; id: string; args: unknown }[];
  /** Every element the script created. */
  readonly created: FakeNode[];
}

/** Evaluate the shipped `addon/content/summarize.js` against a fake document. */
function rowsHarness(): RowsHarness {
  const container = new FakeNode("div", XHTML);
  const sets: RowsHarness["sets"] = [];
  const created: FakeNode[] = [];
  const doc = {
    title: "",
    getElementById: (id: string): FakeNode | null =>
      id === "rh-summarize-rows" ? container : null,
    createElementNS: (namespace: string, name: string): FakeNode => {
      const element = new FakeNode(name, namespace);
      created.push(element);
      return element;
    },
    l10n: {
      setAttributes: (element: FakeNode, id: string, args?: unknown) => {
        sets.push({ element, id, args });
        element.setAttribute("data-l10n-id", id);
        element.setAttribute("data-l10n-args", JSON.stringify(args ?? null));
      },
    },
  };
  const code = readFileSync(
    resolve(ROOT, "addon/content/summarize.js"),
    "utf8",
  );
  // `new Function` rather than an import: the file is a classic chrome script
  // with no exports, as `searchDialog.test.ts`'s harness says.
  const factory = new Function(
    "Zotero",
    "window",
    "document",
    "ChromeUtils",
    `${code}\nreturn RHSummarizeWindow;`,
  ) as (...globals: unknown[]) => RowsHarness["controller"];
  const controller = factory(
    { debug: () => undefined },
    { addEventListener: () => undefined },
    doc,
    undefined,
  );
  return { controller, container, sets, created };
}

type Status = SummarizeRunView["rows"][number]["status"];

function rowsOf(
  ...rows: readonly (readonly [key: string, status: Status])[]
): SummarizeRunView["rows"] {
  return rows.map(([itemKey, status]) => ({
    itemKey,
    title: `Title of ${itemKey}`,
    status,
  }));
}

/** The window's rows for a run view, as the session builds them. */
function modelRows(rows: SummarizeRunView["rows"]): readonly unknown[] {
  return buildSummarizeWindowModel(view({ rows }), { running: true }).rows;
}

function statusOf(element: FakeNode | undefined): unknown {
  const args = element?.getAttribute("data-l10n-args");
  return args ? (JSON.parse(args) as { status?: unknown }).status : undefined;
}

describe("P7-T42 — the summarize window redraws only the rows that change", () => {
  it("each row line carries its item's key, beside an unchanged Fluent line", () => {
    const rows = modelRows(
      rowsOf(["AAAA1111", "queued"], ["BBBB2222", "done"]),
    );
    expect(rows).toStrictEqual([
      {
        key: "AAAA1111",
        id: SUMMARIZE_DIALOG_L10N.row,
        args: { status: "queued", title: "Title of AAAA1111" },
      },
      {
        key: "BBBB2222",
        id: SUMMARIZE_DIALOG_L10N.row,
        args: { status: "done", title: "Title of BBBB2222" },
      },
    ]);
  });

  it("draws one XHTML <p> per row, in order, each set once", () => {
    const h = rowsHarness();
    h.controller.renderRows(
      modelRows(rowsOf(["A", "queued"], ["B", "queued"], ["C", "queued"])),
    );
    expect(h.container.childNodes.map((p) => p.localName)).toEqual([
      "p",
      "p",
      "p",
    ]);
    expect(h.container.childNodes.every((p) => p.namespace === XHTML)).toBe(
      true,
    );
    expect(h.sets.map((set) => set.id)).toEqual([
      SUMMARIZE_DIALOG_L10N.row,
      SUMMARIZE_DIALOG_L10N.row,
      SUMMARIZE_DIALOG_L10N.row,
    ]);
    expect(h.sets.map((set) => set.element)).toEqual(h.container.childNodes);
    expect(h.container.childNodes.map((p) => statusOf(p))).toEqual([
      "queued",
      "queued",
      "queued",
    ]);
  });

  it("an update that changes one row touches that row's element only, and the others keep their identity", () => {
    const h = rowsHarness();
    h.controller.renderRows(
      modelRows(rowsOf(["A", "queued"], ["B", "queued"], ["C", "queued"])),
    );
    const [a, b, c] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.renderRows(
      modelRows(rowsOf(["A", "queued"], ["B", "running"], ["C", "queued"])),
    );
    expect(h.container.childNodes).toHaveLength(3);
    expect(h.container.childNodes[0]).toBe(a);
    expect(h.container.childNodes[1]).toBe(b);
    expect(h.container.childNodes[2]).toBe(c);
    expect(h.created).toHaveLength(3);
    expect(h.sets).toHaveLength(1);
    expect(h.sets[0]?.element).toBe(b);
    expect(statusOf(b)).toBe("running");
    expect(statusOf(a)).toBe("queued");
  });

  it("an update that changes nothing touches no row", () => {
    const h = rowsHarness();
    const rows = rowsOf(["A", "done"], ["B", "failed"]);
    h.controller.renderRows(modelRows(rows));
    const [a, b] = h.container.childNodes;
    h.sets.length = 0;
    for (let i = 0; i < 5; i += 1) h.controller.renderRows(modelRows(rows));
    expect(h.sets).toHaveLength(0);
    expect(h.created).toHaveLength(2);
    expect(h.container.childNodes[0]).toBe(a);
    expect(h.container.childNodes[1]).toBe(b);
  });

  it("a title change is a change too", () => {
    const h = rowsHarness();
    h.controller.renderRows(modelRows(rowsOf(["A", "done"])));
    const [a] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.renderRows(
      modelRows([{ itemKey: "A", title: "Renamed", status: "done" }]),
    );
    expect(h.sets).toHaveLength(1);
    expect(h.sets[0]?.element).toBe(a);
    expect(h.sets[0]?.args).toEqual({ status: "done", title: "Renamed" });
  });

  it("a row that goes is removed, and only it", () => {
    const h = rowsHarness();
    h.controller.renderRows(
      modelRows(rowsOf(["A", "done"], ["B", "done"], ["C", "done"])),
    );
    const [a, b, c] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.renderRows(modelRows(rowsOf(["A", "done"], ["C", "done"])));
    expect(h.container.childNodes).toHaveLength(2);
    expect(h.container.childNodes[0]).toBe(a);
    expect(h.container.childNodes[1]).toBe(c);
    expect(b?.parentNode).toBeNull();
    expect(h.sets).toHaveLength(0);
    h.controller.renderRows([]);
    expect(h.container.childNodes).toHaveLength(0);
  });

  it("a row that appears is added in its place, and the others stay", () => {
    const h = rowsHarness();
    h.controller.renderRows(
      modelRows(rowsOf(["A", "queued"], ["C", "queued"])),
    );
    const [a, c] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.renderRows(
      modelRows(rowsOf(["A", "queued"], ["B", "queued"], ["C", "queued"])),
    );
    expect(h.container.childNodes).toHaveLength(3);
    expect(h.container.childNodes[0]).toBe(a);
    expect(h.container.childNodes[2]).toBe(c);
    expect(h.sets).toHaveLength(1);
    expect(h.sets[0]?.element).toBe(h.container.childNodes[1]);
  });

  it("a new order moves the same elements into the model's order", () => {
    const h = rowsHarness();
    h.controller.renderRows(
      modelRows(rowsOf(["A", "done"], ["B", "queued"], ["C", "failed"])),
    );
    const [a, b, c] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.renderRows(
      modelRows(rowsOf(["C", "failed"], ["A", "done"], ["B", "queued"])),
    );
    expect(h.container.childNodes).toHaveLength(3);
    expect(h.container.childNodes[0]).toBe(c);
    expect(h.container.childNodes[1]).toBe(a);
    expect(h.container.childNodes[2]).toBe(b);
    expect(h.container.childNodes.map((p) => statusOf(p))).toEqual([
      "failed",
      "done",
      "queued",
    ]);
    expect(h.sets).toHaveLength(0);
    expect(h.created).toHaveLength(3);
  });

  it("500 rows that settle one at a time make 500 elements, each set once per change", () => {
    const h = rowsHarness();
    const keys = Array.from({ length: 500 }, (_, i) => `K${String(i)}`);
    const statuses = new Map<string, Status>(keys.map((k) => [k, "queued"]));
    const draw = (): void => {
      h.controller.renderRows(
        modelRows(
          rowsOf(...keys.map((k) => [k, statuses.get(k) ?? "queued"] as const)),
        ),
      );
    };
    draw();
    const first = [...h.container.childNodes];
    for (const key of keys) {
      statuses.set(key, "running");
      draw();
      statuses.set(key, "done");
      draw();
    }
    expect(h.created).toHaveLength(500);
    expect(h.sets).toHaveLength(500 * 3);
    expect(h.container.childNodes).toHaveLength(500);
    expect(h.container.childNodes.every((p, i) => p === first[i])).toBe(true);
  });

  it("rows without a key, as an older model drew them, are kept by place", () => {
    const h = rowsHarness();
    const line = (status: string) => ({
      id: SUMMARIZE_DIALOG_L10N.row,
      args: { status, title: "t" },
    });
    h.controller.renderRows([line("queued"), line("queued")]);
    const [first, second] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.renderRows([line("queued"), line("done")]);
    expect(h.container.childNodes[0]).toBe(first);
    expect(h.container.childNodes[1]).toBe(second);
    expect(h.sets.map((set) => set.element)).toEqual([second]);
  });

  it("render() sends the model's rows down the same path", () => {
    const h = rowsHarness();
    const model = (status: Status) =>
      buildSummarizeWindowModel(
        view({ rows: rowsOf(["A", "done"], ["B", status]) }),
        { running: true },
      );
    h.controller.render(model("queued"));
    const [a, b] = h.container.childNodes;
    h.sets.length = 0;
    h.controller.render(model("done"));
    expect(h.container.childNodes[0]).toBe(a);
    expect(h.container.childNodes[1]).toBe(b);
    expect(h.sets.map((set) => set.element)).toEqual([b]);
  });
});

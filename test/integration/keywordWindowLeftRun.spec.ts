/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3) and asserts on the platform's own state; there is no src/zotero/ facade to go through from outside the plugin bundle. */
/**
 * `plan/00` §6 item 350(d): does the keyword search window raise the "cancelled" toast
 * the related window raised when a run was left? `searchImportViewModel.ts` uses the
 * same reporter with `openOn: "completion"`. Written and measured in the integration
 * round of 2026-11-06, in a real window on the real published host, with every source
 * a stub in the real registry's slot. The answer is no: this view model outlives its
 * window (`docs/08` §8.1's row for a job that ends while its window is closed), so
 * leaving does not cancel, and only the Cancel button's toast says cancelled.
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import type { SourceId } from "../../src/model/ids";
import type { SourceRecord } from "../../src/model/sourceRecord";
import type {
  LiteratureSource,
  SourceCallContext,
} from "../../src/sources/types";
import { openSearchWindow } from "../../src/ui/dialogs/searchDialog";
import {
  pinUILocale,
  restoreUILocale,
  type UILocaleSnapshot,
} from "./support/uiLocale";

interface TestContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: TestContext) => Promise<void>,
): void;
declare function before(body: (this: TestContext) => Promise<void>): void;
declare function after(body: (this: TestContext) => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  deepEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[keyword-left-run]";

interface KeywordController {
  readonly state: {
    readonly initialized: boolean;
    readonly running: boolean;
    readonly panel: string;
  };
  search(): void;
  cancel(): void;
  sourceBoxes(): readonly (Element & { checked: boolean })[];
  refreshSearchGate(): unknown;
}
/** The members of a real `Zotero.ProgressWindow` this spec listens on. */
interface ToastHandle {
  ItemProgress: new (...args: unknown[]) => { setText(text: string): void };
  close(): void;
}
type KeywordWindow = Window & { readonly RHSearchWindow?: KeywordController };

async function waitUntil(
  predicate: () => boolean,
  what: string,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail(
        `timed out after ${String(timeoutMs)} ms waiting for ${what}`,
      );
    }
    await Zotero.Promise.delay(25);
  }
}

describe("The keyword window: a left run's toast (plan/00 item 350(d))", () => {
  const STUB: SourceId = "pubmed";
  /** What the stub's lists did, and how the test lets one go. */
  const lists = { started: 0, cancelled: 0, released: 0, ended: 0 };
  let release = false;
  let displaced: LiteratureSource | undefined;
  let localeBefore: UILocaleSnapshot | undefined;
  /** One entry for each toast the platform was asked for. */
  const toasts: string[] = [];
  /** Every line any toast drew, in order. */
  const words: string[] = [];
  /** How long each toast that closed stayed up, in ms. */
  const closedAfter: number[] = [];
  let restoreToasts: (() => void) | undefined;

  function services(): NonNullable<Addon["api"]["services"]> {
    const instance = (Zotero as unknown as Record<string, Addon | undefined>)[
      config.addonInstance
    ];
    const graph = instance?.api.services;
    if (!graph) assert.fail("no ServiceGraph is published at api.services");
    return graph;
  }

  before(async function () {
    this.timeout(60_000);
    localeBefore = await pinUILocale(["en-US"], (line) => {
      debug(`${LOG_PREFIX} ${line}`);
    });
    const registry = services().sources;
    const real = registry.get(STUB);
    if (!real) assert.fail("no pubmed adapter");
    const stub: LiteratureSource = Object.assign(
      Object.create(real) as LiteratureSource,
      {
        isConfigured: () => true,
        searchAll: (_query: unknown, ctx: SourceCallContext) => ({
          // eslint-disable-next-line require-yield -- a list that holds open and ends empty.
          async *[Symbol.asyncIterator](): AsyncIterator<SourceRecord> {
            lists.started += 1;
            try {
              while (!release) {
                if (ctx.token.isCancellationRequested) {
                  lists.cancelled += 1;
                  ctx.token.throwIfCancelled();
                }
                await Zotero.Promise.delay(25);
              }
              lists.released += 1;
            } finally {
              lists.ended += 1;
            }
          },
        }),
      },
    );
    displaced = registry.replaceForTest(stub);
    const platform = Zotero as unknown as {
      ProgressWindow: new (...args: unknown[]) => ToastHandle;
    };
    const Real = platform.ProgressWindow;
    platform.ProgressWindow = new Proxy(Real, {
      construct(target, args, newTarget) {
        toasts.push("(toast)");
        const made = Reflect.construct(target, args, newTarget) as ToastHandle;
        const raisedAt = Date.now();
        const close = made.close;
        made.close = function (this: unknown): void {
          closedAfter.push(Date.now() - raisedAt);
          debug(
            `${LOG_PREFIX} a toast closed ${String(Date.now() - raisedAt)} ms after it was raised`,
          );
          close.call(this);
        };
        const RealLine = made.ItemProgress;
        made.ItemProgress = new Proxy(RealLine, {
          construct(line, lineArgs, lineTarget) {
            const drawn = Reflect.construct(line, lineArgs, lineTarget) as {
              setText(text: string): void;
            };
            words.push(String(lineArgs[1]));
            const setText = drawn.setText;
            drawn.setText = function (this: unknown, text: string): void {
              words.push(text);
              setText.call(this, text);
            };
            return drawn;
          },
        });
        return made;
      },
    });
    restoreToasts = () => {
      platform.ProgressWindow = Real;
    };
  });

  after(async function () {
    this.timeout(60_000);
    release = true;
    await waitUntil(() => lists.ended >= lists.started, "the lists to end");
    await Zotero.Promise.delay(250);
    restoreToasts?.();
    if (displaced) services().sources.replaceForTest(displaced);
    if (localeBefore) {
      await restoreUILocale(localeBefore, (line) => {
        debug(`${LOG_PREFIX} ${line}`);
      });
      localeBefore = undefined;
    }
  });

  function open(): KeywordWindow {
    return openSearchWindow(Zotero.getMainWindow(), {
      mode: "keyword",
    }) as KeywordWindow;
  }

  async function ready(win: KeywordWindow): Promise<KeywordController> {
    await waitUntil(
      () => win.RHSearchWindow?.state.initialized === true,
      "the window to initialize",
    );
    return win.RHSearchWindow as KeywordController;
  }

  /** Start one search on the stub, and wait for its list to be in flight. */
  async function aRunGoing(win: KeywordWindow): Promise<KeywordController> {
    const controller = await ready(win);
    const input = win.document.getElementById(
      "rh-search-keyword",
    ) as unknown as { value: string };
    input.value = "left run";
    for (const box of controller.sourceBoxes()) {
      box.checked = box.getAttribute("value") === STUB;
    }
    controller.refreshSearchGate();
    const before = lists.started;
    controller.search();
    await waitUntil(() => lists.started > before, "the list to start");
    return controller;
  }

  /** Let the run go, and wait for its list and whatever it does afterwards. */
  async function letItEnd(): Promise<void> {
    release = true;
    await waitUntil(() => lists.ended >= lists.started, "the list to end");
    await Zotero.Promise.delay(1_000);
    release = false;
  }

  /** The words of the toast raised since `from`, once they are drawn. */
  async function wordsSince(from: number): Promise<string> {
    const drawn = (): string[] =>
      words.slice(from).filter((line) => line !== "");
    await waitUntil(() => drawn().length > 0, "the toast's words");
    return drawn().join(" | ");
  }

  it("closing the window during a run leaves it going, and its end raises a toast that is not a cancel", async function () {
    this.timeout(60_000);
    const win = open();
    await aRunGoing(win);
    const before = toasts.length;
    const wordsBefore = words.length;
    const cancelledBefore = lists.cancelled;
    win.close();
    await Zotero.Promise.delay(1_000);
    debug(
      `${LOG_PREFIX} close: ${String(toasts.length - before)} toasts, ` +
        `${String(lists.cancelled - cancelledBefore)} lists cancelled, ` +
        `${String(lists.started - lists.ended)} still going`,
    );
    assert.strictEqual(toasts.length, before, "closing raises no toast");
    assert.strictEqual(lists.cancelled, cancelledBefore, "and cancels nothing");
    await letItEnd();
    const said = await wordsSince(wordsBefore);
    debug(
      `${LOG_PREFIX} close, after the run ended: ` +
        `${String(toasts.length - before)} toast, ${said}`,
    );
    assert.strictEqual(toasts.length - before, 1, "the run's end raises one");
    // `letItEnd` waited a second, and a toast closed by the job's end would be here.
    assert.deepEqual(closedAfter.splice(0), [], "and it stays up");
    assert.isFalse(/cancel/iu.test(said), "and it does not say cancelled");
  });

  it("re-opening the window during a run joins it, and raises no cancel", async function () {
    this.timeout(60_000);
    const win = open();
    await aRunGoing(win);
    const before = toasts.length;
    const wordsBefore = words.length;
    const cancelledBefore = lists.cancelled;
    const again = open();
    await Zotero.Promise.delay(250);
    const controller = await ready(again);
    await Zotero.Promise.delay(1_000);
    debug(
      `${LOG_PREFIX} re-open: ${String(toasts.length - before)} toasts, ` +
        `${String(lists.cancelled - cancelledBefore)} lists cancelled, new window ` +
        `running ${String(controller.state.running)} panel ${controller.state.panel}, ` +
        `searching panel hidden ${String(again.document.getElementById("rh-state-searching")?.hasAttribute("hidden"))}, ` +
        `first panel hidden ${String(again.document.getElementById("rh-state-initial")?.hasAttribute("hidden"))}, ` +
        `Cancel ${String(again.document.getElementById("rh-search-cancel")?.hasAttribute("hidden"))}`,
    );
    assert.strictEqual(toasts.length, before, "re-opening raises no toast");
    assert.strictEqual(lists.cancelled, cancelledBefore, "and cancels nothing");
    assert.isTrue(
      controller.state.running,
      "the new window shows the same run",
    );
    await letItEnd();
    const said = await wordsSince(wordsBefore);
    debug(
      `${LOG_PREFIX} re-open, after the run ended: ` +
        `${String(toasts.length - before)} toasts, ${said}`,
    );
    assert.isFalse(
      /cancel/iu.test(said),
      "the run's end does not say cancelled",
    );
    again.close();
    await Zotero.Promise.delay(250);
  });

  it("the Cancel button keeps its toast", async function () {
    this.timeout(60_000);
    const win = open();
    const controller = await aRunGoing(win);
    const before = toasts.length;
    const wordsBefore = words.length;
    controller.cancel();
    await waitUntil(() => toasts.length > before, "the Cancel toast");
    const said = await wordsSince(wordsBefore);
    debug(
      `${LOG_PREFIX} Cancel: ${String(toasts.length - before)} toast, ${said}`,
    );
    assert.strictEqual(toasts.length - before, 1);
    assert.isTrue(/cancel/iu.test(said), "the toast says cancelled");
    win.close();
    await Zotero.Promise.delay(250);
  });
});

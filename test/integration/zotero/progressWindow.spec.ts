/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3), and this card's whole deliverable is a measurement of `Zotero.ProgressWindow` itself. There is no `src/zotero/` facade that could report which members the platform object actually carries. */
/**
 * `P1-T29`: the `Zotero.ProgressWindow` / `ItemProgress` signatures, measured
 * against a running Zotero.
 *
 * ## What was in dispute
 *
 * Three sources disagreed, and two of them are in this repository
 * (`P1-T15`, 2026-09-30):
 *
 * | | `ItemProgress`'s first argument | icon setter |
 * |---|---|---|
 * | `docs/08` §8.2 (read from `progressWindow.js`) | an **item type** string | `setItemTypeAndIcon(itemType, cssIcon = 'item-type')`; "there is **no `setIcon()`**" |
 * | `zotero-types@4.1.3` | `iconSrc` | `setIcon(iconSrc)`, and **no** `setItemTypeAndIcon` |
 * | `docs/07` §7.7's sketch | `/* iconURI *\/ ""` | — |
 *
 * `docs/07` §7.7 carried a `> **Unverified:**` marker asking for the result to
 * be recorded in `docs/01`. This spec is the measurement; `docs/01` §10.2.1 is
 * the record.
 *
 * ## How it measures, and why that way
 *
 * The card's `Do` step 2 asks *which* setter exists, not whether a call throws.
 * A call that throws proves nothing useful here — `ItemProgress`'s methods are
 * all wrapped in Zotero's `_deferUntilWindowLoad`, so a method that does not
 * exist throws a `TypeError` while a method that exists but is queued throws
 * nothing *and does nothing*, and the two are indistinguishable from the
 * outside. So the measurement is **reflective**: own and prototype property
 * names, `typeof` per member, and each member's declared parameter list read
 * back out of `Function.prototype.toString()` on the live function object.
 * That last one is the actual shipped signature, not a restatement of a doc.
 *
 * Then it drives a real popup — headline, one line, 45 %, `setError()`, close —
 * and compares what an **item-type** first argument and a **path** first
 * argument each do to the line's icon element. `docs/08` §8.2 calls passing a
 * path "a live Zotero bug. Do not copy it."; this spec records what the bug
 * actually looks like rather than only that it is one.
 *
 * ## Housekeeping
 *
 * Every popup this file opens is closed in a `finally`, and the `after` hook
 * calls `Zotero.ProgressWindowSet.closeAll()` and logs what was left, so a
 * failing assertion cannot leave a floating window over the next spec file.
 *
 * `close()` is only ever called on a window that was `show()`n: Zotero's
 * `close()` dereferences its private `_progressWindow`, which is `null` until
 * `show()`, and the resulting `TypeError` is swallowed into
 * `Zotero.logError()` — harmless, but it would put a spurious error in the log
 * of a passing run.
 *
 * Sandbox caveats (`docs/01` §2.3, measured `P0-T08`): no `performance`, no
 * `console`, no `AbortController`. `Date.now()` is the clock and `debug()` is
 * the log.
 */

import {
  type ProgressWindowHandle,
  openZoteroProgressWindow,
} from "../../../src/zotero/progressWindow";

// Mocha and Chai globals injected by the scaffold runner's index.xhtml. Typed
// locally, to exactly what this file uses: no Mocha types are installed.
interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare function after(body: () => Promise<void>): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  notStrictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isFalse(value: boolean, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const LOG_PREFIX = "[P1-T29]";

/** The `windowtype` attribute of `chrome://zotero/content/progressWindow.xhtml`. */
const PROGRESS_WINDOW_TYPE = "alert:alert";

/** `docs/08` §8.2's worked example passes this as the first argument. */
const ITEM_TYPE_ARG = "journalArticle";

/**
 * A first argument of the shape `zotero-types@4.1.3` names (`iconSrc`) and
 * `docs/07` §7.7's sketch commented (`iconURI`). Passing it is what `docs/08`
 * §8.2 calls "a live Zotero bug"; this spec records the symptom.
 */
const ICON_PATH_ARG = "chrome://zotero/skin/treeitem-journalArticle@2x.png";

const STEP_TIMEOUT_MS = 15_000;
/** Long enough to tell "the timer fired" from "the timer was never set". */
const CLOSE_TIMER_MS = 1500;

// ---------------------------------------------------------------------------
// Reflection helpers. These are the measurement.
// ---------------------------------------------------------------------------

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** Own property names, sorted. */
function ownNames(value: object): string[] {
  return Object.getOwnPropertyNames(value).sort();
}

/** Property names from every prototype up to, but excluding, `Object.prototype`. */
function prototypeNames(value: object): string[] {
  const names: string[] = [];
  let cursor = Object.getPrototypeOf(value) as object | null;
  while (cursor !== null && cursor !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(cursor)) {
      if (!names.includes(name)) names.push(name);
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return names.sort();
}

/** `typeof host[key]`, or `"<throws>"` for an accessor that raises. */
function kindOf(host: object, key: string): string {
  try {
    const value = asRecord(host)[key];
    return value === null ? "null" : typeof value;
  } catch {
    return "<throws>";
  }
}

/**
 * The declared parameter list of a live function, read from its own source.
 *
 * Parentheses are balanced rather than scanned to the first `)`, because a
 * default value may contain one.
 */
function signatureOf(fn: unknown): string {
  if (typeof fn !== "function") return `<${typeof fn}>`;
  const source = Function.prototype.toString.call(fn);
  const open = source.indexOf("(");
  if (open < 0) return "<no parameter list>";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1).replace(/\s+/g, " ");
    }
  }
  return "<unbalanced parameter list>";
}

/** One `name: typeof name(params) [arity]` line per member. */
function logMembers(label: string, host: object, members: readonly string[]) {
  for (const name of members) {
    const value = (() => {
      try {
        return asRecord(host)[name];
      } catch {
        return undefined;
      }
    })();
    const arity = typeof value === "function" ? ` [arity ${value.length}]` : "";
    debug(
      `${LOG_PREFIX} ${label}.${name}: ${kindOf(host, name)} ` +
        `${signatureOf(value)}${arity}`,
    );
  }
}

const MAX_SOURCE_LINES = 45;

/** Log a live function's own source, which is the shipped implementation. */
function logSource(label: string, fn: unknown): void {
  if (typeof fn !== "function") {
    debug(`${LOG_PREFIX} ${label}: not a function (${typeof fn})`);
    return;
  }
  const lines = Function.prototype.toString.call(fn).split("\n");
  debug(`${LOG_PREFIX} ${label}: ${lines.length} source line(s)`);
  for (const [index, text] of lines.slice(0, MAX_SOURCE_LINES).entries()) {
    debug(`${LOG_PREFIX}   ${label}:${index + 1}| ${text.trimEnd()}`);
  }
  if (lines.length > MAX_SOURCE_LINES) {
    const elided = lines.length - MAX_SOURCE_LINES;
    debug(`${LOG_PREFIX}   ${label}: … ${elided} further line(s) elided`);
  }
}

// ---------------------------------------------------------------------------
// Open-window bookkeeping
// ---------------------------------------------------------------------------

interface SimpleEnumerator {
  hasMoreElements(): boolean;
  getNext(): unknown;
}

interface MaybeWindow {
  closed?: boolean;
  location?: { href?: string };
}

/** The `href` of every open Zotero progress window. */
function openProgressWindows(): string[] {
  const hrefs: string[] = [];
  const enumerator = Services.wm.getEnumerator(
    PROGRESS_WINDOW_TYPE,
  ) as unknown as SimpleEnumerator;
  while (enumerator.hasMoreElements()) {
    const win = enumerator.getNext() as MaybeWindow;
    let href: string;
    try {
      href = win.closed === true ? "" : (win.location?.href ?? "");
    } catch {
      // A window torn down between the enumeration and this read.
      href = "";
    }
    if (href.includes("progressWindow.xhtml")) hrefs.push(href);
  }
  return hrefs;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > STEP_TIMEOUT_MS) {
      assert.fail(`timed out after ${STEP_TIMEOUT_MS} ms waiting for ${what}`);
    }
    await delay(100);
  }
}

/** Close a shown popup and wait for the window list to drop back to `floor`. */
async function closeAndSettle(
  pw: { close(): void },
  floor: number,
): Promise<void> {
  pw.close();
  await waitUntil(
    () => openProgressWindows().length <= floor,
    `the popup to leave the window list (floor ${floor})`,
  );
}

/**
 * Log what one `ItemProgress` did to the DOM.
 *
 * `_image`, `_hbox`, `_itemText` and `_iconClassName` are Zotero's own private
 * fields; reading them is the only way to see which element the first
 * constructor argument landed in, which is the question the card asks.
 */
function logLineDom(label: string, line: object): void {
  debug(`${LOG_PREFIX} ${label}: own ${ownNames(line).join(", ") || "(none)"}`);
  const image = asRecord(line)["_image"] as
    | {
        className?: unknown;
        dataset?: Record<string, string | undefined>;
        outerHTML?: unknown;
        ownerDocument?: {
          defaultView?: {
            getComputedStyle(el: object): Record<string, unknown>;
          } | null;
        };
      }
    | undefined;
  if (image === undefined) {
    debug(`${LOG_PREFIX} ${label}: no _image element (window never loaded?)`);
    return;
  }
  debug(
    `${LOG_PREFIX} ${label}: _image.className = ${String(image.className)}`,
  );
  debug(
    `${LOG_PREFIX} ${label}: _image.dataset.itemType = ` +
      `${JSON.stringify(image.dataset?.["itemType"])}`,
  );
  debug(
    `${LOG_PREFIX} ${label}: _iconClassName = ` +
      `${String(asRecord(line)["_iconClassName"])}`,
  );
  const html = typeof image.outerHTML === "string" ? image.outerHTML : "";
  debug(
    `${LOG_PREFIX} ${label}: _image.outerHTML = ` +
      (html.length > 400 ? `${html.slice(0, 400)}…` : html),
  );
  // Whether the icon actually resolves is a CSS question, so ask CSS.
  try {
    const view = image.ownerDocument?.defaultView;
    if (view) {
      const style = view.getComputedStyle(image);
      for (const prop of ["content", "backgroundImage", "maskImage"]) {
        debug(
          `${LOG_PREFIX} ${label}: computed ${prop} = ` +
            `${String(style[prop] ?? "<unset>")}`,
        );
      }
    }
  } catch (e) {
    debug(`${LOG_PREFIX} ${label}: computed style unavailable (${String(e)})`);
  }
}

// ---------------------------------------------------------------------------

describe("P1-T29 — Zotero.ProgressWindow / ItemProgress signatures", () => {
  after(async () => {
    Zotero.ProgressWindowSet.closeAll();
    await delay(300);
    const left = openProgressWindows();
    debug(
      `${LOG_PREFIX} teardown: ${left.length} progress window(s) left open` +
        (left.length > 0 ? ` — ${left.join(", ")}` : ""),
    );
  });

  it("reports the live Zotero.ProgressWindow surface", async function () {
    this.timeout(STEP_TIMEOUT_MS);
    debug(
      `${LOG_PREFIX} Zotero ${Zotero.version} on ${Services.appinfo.OS}, ` +
        `Gecko ${Services.appinfo.platformVersion}, locale ${Zotero.locale}`,
    );
    assert.strictEqual(
      typeof Zotero.ProgressWindow,
      "function",
      "Zotero.ProgressWindow must be a constructor",
    );
    assert.strictEqual(
      typeof Zotero.ProgressWindowSet.closeAll,
      "function",
      "Zotero.ProgressWindowSet.closeAll",
    );

    // Not shown, so no window opens and none has to be closed.
    const pw = new Zotero.ProgressWindow({
      closeOnClick: false,
      window: Zotero.getMainWindow(),
    });

    debug(`${LOG_PREFIX} ProgressWindow own: ${ownNames(pw).join(", ")}`);
    debug(
      `${LOG_PREFIX} ProgressWindow prototype: ` +
        `${prototypeNames(pw).join(", ") || "(nothing above Object.prototype)"}`,
    );
    logMembers("pw", pw, [
      "show",
      "changeHeadline",
      "addLines",
      "addDescription",
      "startCloseTimer",
      "close",
      "ItemProgress",
      "Translation",
    ]);
    logSource("pw.startCloseTimer", asRecord(pw)["startCloseTimer"]);

    // The five members `openZoteroProgressWindow()` names.
    for (const name of [
      "show",
      "changeHeadline",
      "startCloseTimer",
      "close",
      "ItemProgress",
    ]) {
      assert.strictEqual(
        kindOf(pw, name),
        "function",
        `pw.${name} must exist — openZoteroProgressWindow() calls it`,
      );
    }
    // Named by §7.7's marker, so measured even though the wrapper omits them.
    assert.strictEqual(kindOf(pw, "addLines"), "function", "pw.addLines");
    assert.strictEqual(
      kindOf(pw, "addDescription"),
      "function",
      "pw.addDescription",
    );
  });

  it("names the icon setter: setItemTypeAndIcon exists, setIcon does not", async function () {
    this.timeout(STEP_TIMEOUT_MS);
    const pw = new Zotero.ProgressWindow({
      closeOnClick: false,
      window: Zotero.getMainWindow(),
    });

    logSource("pw.ItemProgress", asRecord(pw)["ItemProgress"]);
    const ctor = asRecord(pw)["ItemProgress"] as { prototype: object };
    debug(
      `${LOG_PREFIX} ItemProgress.prototype own: ` +
        `${ownNames(ctor.prototype).join(", ")}`,
    );

    // Constructed, never shown: the ctor body is deferred until the window
    // loads, so this allocates the object and its prototype and nothing else.
    const line = new pw.ItemProgress(ITEM_TYPE_ARG, "P1-T29 probe");
    debug(
      `${LOG_PREFIX} ItemProgress instance own: ` +
        `${ownNames(line).join(", ") || "(none)"}`,
    );
    debug(
      `${LOG_PREFIX} ItemProgress instance prototype: ` +
        `${prototypeNames(line).join(", ")}`,
    );
    logMembers("line", line, [
      "setProgress",
      "setText",
      "setError",
      "setIcon",
      "setItemTypeAndIcon",
    ]);
    logSource("line.setItemTypeAndIcon", asRecord(line)["setItemTypeAndIcon"]);

    // The measurement, pinned so a future Zotero change fails this spec.
    assert.strictEqual(
      kindOf(line, "setItemTypeAndIcon"),
      "function",
      "docs/08 §8.2 is right: setItemTypeAndIcon exists",
    );
    assert.strictEqual(
      kindOf(line, "setIcon"),
      "undefined",
      "zotero-types@4.1.3 is wrong: there is no setIcon",
    );
    for (const name of ["setProgress", "setText", "setError"]) {
      assert.strictEqual(
        kindOf(line, name),
        "function",
        `line.${name} must exist — ProgressWindowLine declares it`,
      );
    }
  });

  it("drives a real popup through openZoteroProgressWindow()", async function () {
    this.timeout(STEP_TIMEOUT_MS * 3);
    const floor = openProgressWindows().length;
    const handle: ProgressWindowHandle = openZoteroProgressWindow(
      Zotero.getMainWindow(),
    );
    let shown = false;
    try {
      // Deferred until load, so this ordering is deliberate and is the
      // wrapper's own: headline and line before show(), timer after it.
      handle.changeHeadline("Research Helper — P1-T29", "library", "probing…");
      const line = handle.addLine(ITEM_TYPE_ARG, "P1-T29 progress line");
      handle.show();
      shown = true;
      await waitUntil(
        () => openProgressWindows().length > floor,
        "the popup to appear in the window list",
      );
      line.setProgress(45);
      line.setText("P1-T29 progress line — 45 %");
      await delay(400);
      line.setError();
      await delay(400);
      debug(
        `${LOG_PREFIX} popup driven: headline, line, setProgress(45), ` +
          `setText, setError — no throw`,
      );
      await closeAndSettle({ close: () => handle.close() }, floor);
      shown = false;
      assert.strictEqual(
        openProgressWindows().length,
        floor,
        "close() must leave no progress window behind",
      );
    } finally {
      if (shown) handle.close();
    }
  });

  it("records what ItemProgress does with an item-type and with a path first argument", async function () {
    this.timeout(STEP_TIMEOUT_MS * 3);
    const floor = openProgressWindows().length;
    const pw = new Zotero.ProgressWindow({
      closeOnClick: false,
      window: Zotero.getMainWindow(),
    });
    let shown = false;
    try {
      pw.changeHeadline("Research Helper — P1-T29 icons", "library");
      const typed = new pw.ItemProgress(
        ITEM_TYPE_ARG,
        `first argument = ${ITEM_TYPE_ARG}`,
      );
      const pathed = new pw.ItemProgress(
        ICON_PATH_ARG,
        "first argument = a chrome:// png path",
      );
      pw.show();
      shown = true;
      await waitUntil(
        () => openProgressWindows().length > floor,
        "the icon-comparison popup to appear",
      );
      // 100 restores the icon class the constructor chose (`_iconClassName`),
      // which is the state worth photographing.
      typed.setProgress(100);
      pathed.setProgress(100);
      await delay(600);

      logLineDom("itemType arg", typed);
      logLineDom("path arg", pathed);

      const typedImage = asRecord(typed)["_image"] as
        | { className?: unknown; dataset?: Record<string, string | undefined> }
        | undefined;
      const pathedImage = asRecord(pathed)["_image"] as
        | { className?: unknown; dataset?: Record<string, string | undefined> }
        | undefined;
      if (typedImage === undefined || pathedImage === undefined) {
        assert.fail(
          "neither line built an _image element — nothing to compare",
        );
      }

      // Both arguments take the same code path: the constructor forwards its
      // first argument to `setItemTypeAndIcon(itemType)`, which writes it
      // verbatim into `data-item-type` and sets one fixed class name. So a
      // path does not throw and does not pick a different mechanism — it
      // simply puts a URL where a Zotero item type belongs.
      assert.strictEqual(
        String(typedImage.className),
        String(pathedImage.className),
        "both first-argument shapes must produce the same icon class",
      );
      assert.strictEqual(
        typedImage.dataset?.["itemType"],
        ITEM_TYPE_ARG,
        "an item type lands verbatim in data-item-type",
      );
      assert.strictEqual(
        pathedImage.dataset?.["itemType"],
        ICON_PATH_ARG,
        "a path lands verbatim in data-item-type too — no icon will resolve",
      );

      await closeAndSettle(pw, floor);
      shown = false;
    } finally {
      if (shown) pw.close();
    }
  });

  it("confirms startCloseTimer() is a no-op before show() and arms after it", async function () {
    this.timeout(STEP_TIMEOUT_MS * 4);

    // (a) before show(): the timer must never fire.
    const earlyFloor = openProgressWindows().length;
    const early = new Zotero.ProgressWindow({
      closeOnClick: false,
      window: Zotero.getMainWindow(),
    });
    let earlyShown = false;
    try {
      early.changeHeadline("P1-T29 — timer before show()", "library");
      const earlyLine = new early.ItemProgress(
        ITEM_TYPE_ARG,
        "startCloseTimer() was called before show()",
      );
      early.startCloseTimer(CLOSE_TIMER_MS);
      early.show();
      earlyShown = true;
      await waitUntil(
        () => openProgressWindows().length > earlyFloor,
        "the early popup to appear",
      );
      earlyLine.setProgress(100);
      await delay(CLOSE_TIMER_MS * 3);
      const survived = openProgressWindows().length > earlyFloor;
      debug(
        `${LOG_PREFIX} startCloseTimer(${CLOSE_TIMER_MS}) before show(): ` +
          `popup still open after ${CLOSE_TIMER_MS * 3} ms = ${String(survived)}`,
      );
      assert.isTrue(
        survived,
        "docs/08 §8.2: startCloseTimer() before show() is a no-op",
      );
      await closeAndSettle(early, earlyFloor);
      earlyShown = false;
    } finally {
      if (earlyShown) early.close();
    }

    // (b) after show(): the same call must close the window on its own. This is
    // the ordering `ZoteroProgressWindowSink.paint()` uses, so it is the half
    // that matters to the shipped sink.
    const lateFloor = openProgressWindows().length;
    const late = new Zotero.ProgressWindow({
      closeOnClick: false,
      window: Zotero.getMainWindow(),
    });
    let lateShown = false;
    try {
      late.changeHeadline("P1-T29 — timer after show()", "library");
      const lateLine = new late.ItemProgress(
        ITEM_TYPE_ARG,
        "startCloseTimer() called after show()",
      );
      late.show();
      lateShown = true;
      await waitUntil(
        () => openProgressWindows().length > lateFloor,
        "the late popup to appear",
      );
      lateLine.setProgress(100);
      late.startCloseTimer(CLOSE_TIMER_MS);
      // Zotero disables the timer while the mouse is over the popup
      // (`_onMouseOver` → `_disableTimeout`), so a cursor parked in the
      // bottom-right corner of the screen would keep this window open.
      await waitUntil(
        () => openProgressWindows().length <= lateFloor,
        "the late popup to close itself (mouse must not be over it)",
      );
      lateShown = false;
      debug(
        `${LOG_PREFIX} startCloseTimer(${CLOSE_TIMER_MS}) after show(): ` +
          `popup closed itself`,
      );
    } finally {
      if (lateShown) late.close();
    }
  });
});

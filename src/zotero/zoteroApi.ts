/**
 * The narrow facade over the `Zotero` global (`docs/07` §2.2).
 *
 * `docs/07` §2.3 makes `src/zotero/` the only directory permitted to name
 * `Zotero.*`, and `eslint.config.js`'s `research-helper/zotero-global` rule
 * enforces it. This file is the entry point of that directory: everything the
 * rest of the plugin needs from the platform arrives through a function
 * declared here or in one of `src/zotero/`'s siblings.
 *
 * `P0-T10` gives it three jobs and `P1-T05` adds a fourth:
 *
 * 1. `debug()` / `logError()` / `reportError()` — the log channels. `docs/01`
 *    §2.3 (measured by `P0-T08` on Zotero 10.0.1) records that the plugin
 *    sandbox has **no `console`**: a stray `console.log` throws.
 *    `Zotero.debug()` is the only way out, and `docs/01` §12 gotcha 15 limits
 *    what may go into it. `P1-T32` gave `debug()` the level argument
 *    `docs/07` §10.3 requires and added `logError()`, the second channel
 *    §10.3's `Logger.error()` needs; `src/bootstrap/container.ts`'s
 *    `createZoteroLogSink()` composes the two into `core/`'s `LogSink` port.
 * 2. `schemaReady()` — the gate `docs/01` §12 gotcha 29 requires before any
 *    `Zotero.ItemTypes` / `Zotero.ItemFields` lookup.
 * 3. ~~The `P0-T10` spike command itself.~~ *Retired
 *    2026-11-17 by `plan/10` `P7-T04` (`plan/00` §5 backlog item 25), with
 *    `SPIKE_COLLECTION_NAME` and the spike's fixed work; the fixture lives on in
 *    `test/integration/support/spikeArticle.ts`.*
 * 4. {@link createZoteroHttpTransport} — the one place `Zotero.HTTP.request` is
 *    named. `P1-T05` step 1: `src/core/http/client.ts` owns every option, the
 *    header policy, the classification and the retry, and takes this as a port
 *    because `docs/07` §2.3 forbids `core/` from naming the global.
 * 5. {@link newItemFromMapping} — `P1-T24`. `src/zotero/itemMapper.ts` is pure
 *    by design, so the `new Zotero.Item()` / `fromJSON()` write that turns one
 *    of its mappings into an item lives here. It is what replaced
 *    `P0-T10`'s `buildJournalArticle()`.
 *
 * **This file is `create`d by `P1-T05` per `plan/README.md` §4's sixteen-path
 * list, but its `P0-T10` exports are retained rather than replaced.** `P1-T32`
 * extended it a third time, for the same reason and after the same grep:
 * `debug` and `reportError` are imported by `src/bootstrap/registerUI.ts` and
 * by seven integration specs, so `reportError` keeps its two-argument shape
 * and `debug`'s new `level` stays optional. The spike command those cards kept
 * for the same reason retired with its menu entry, in `P7-T04`.
 */

import type { HttpTransport } from "../core/http/client";
import { LOG_PREFIX } from "../core/logger";

import type { ZoteroItemJSON } from "./itemMapper";

// ---------------------------------------------------------------------------
// The HTTP transport port — `P1-T05`
// ---------------------------------------------------------------------------

/**
 * `Zotero.HTTP` as `src/core/http/client.ts`'s transport port.
 *
 * This is the whole platform half of the HTTP layer. Every option, the
 * `User-Agent`, the status classification, the `Retry-After` handling, the retry
 * loop and the redacted logging live in `core/`; this function only crosses the
 * `docs/07` §2.3 boundary the `research-helper/zotero-global` ESLint rule draws.
 *
 * **`Zotero.HTTP` is assignable to `HttpTransport` without a cast** — that is
 * what `typings/zotero-augment.d.ts` §2 exists to make true, and
 * `scripts/spike-network.ts`'s `zoteroHttpIsPort()` is the compile-time proof.
 * The object is nonetheless built explicitly rather than returned as
 * `Zotero.HTTP`, for two reasons: the five exception classes are read **once,
 * eagerly**, so a call site cannot be handed a half-initialised namespace, and
 * `request` is wrapped in an arrow so the port never depends on `this`.
 *
 * @returns the transport `createHttpClient({ transport })` takes
 */
export function createZoteroHttpTransport(): HttpTransport {
  const http = Zotero.HTTP;
  return {
    request: (method, url, options) => http.request(method, url, options),
    UnexpectedStatusException: http.UnexpectedStatusException,
    TimeoutException: http.TimeoutException,
    BrowserOfflineException: http.BrowserOfflineException,
    SecurityException: http.SecurityException,
    CancelledException: http.CancelledException,
  };
}

// ---------------------------------------------------------------------------
// The log facades — `P0-T10`, levelled and completed by `P1-T32`
// ---------------------------------------------------------------------------

/**
 * `Zotero.debug`'s second argument (`docs/07` §10.3).
 *
 * The same four values `src/core/logger.ts`'s level table produces, written as
 * a literal union rather than `number` so a caller cannot pass Zotero's own
 * `level 5` or a mapped-wrong `0`. **Lower = more severe**, default 3.
 */
export type ZoteroDebugLevel = 1 | 2 | 3 | 4;

/**
 * §10.3's prefix, applied **exactly once**.
 *
 * `P1-T32` item 5: this file used to own a second prefix of its own,
 * `"[research-helper]"`, which differed from `src/core/logger.ts`'s
 * {@link LOG_PREFIX} by one character — so every product log line carried both
 * (`[research-helper] [research_helper] {…}`) and a grep for either found half
 * the lines of the other. There is now one constant, imported from the module
 * `docs/07` §10.3 declares it in, and a line that already carries it is passed
 * through untouched: {@link createLogger}'s line arrives here fully formed,
 * while a bare message from a call site such as a facade helper or
 * an integration spec still gets prefixed.
 *
 * `src/zotero/` may import `core/` (`docs/07` §2.3's arrow,
 * `eslint.config.js`'s `research-helper/layering/adapters` override), so this
 * is the one-source-of-truth form §10.3 asks for when it says the patterns it
 * owns "must not be duplicated with drift".
 */
function prefixed(message: string): string {
  return message.startsWith(LOG_PREFIX) ? message : `${LOG_PREFIX} ${message}`;
}

/**
 * Write one line to Help → Debug Output Logging.
 *
 * `docs/01` §12 gotcha 15: users paste this into bug reports. Log shapes,
 * identifiers and status codes — never a key, a request body or library
 * content.
 *
 * **`level` is `P1-T32` item 2.** `docs/07` §10.3 documents
 * `LogSink.write(line, zoteroLevel)` as passing the level "straight through as
 * `Zotero.debug`'s second argument", and until this card there was no second
 * argument to pass it to, so every line of ours landed at Zotero's default 3
 * and `extensions.zotero.debug.level` filtering could not see our severities.
 *
 * Omitted rather than forwarded as `undefined` when the caller gives no level:
 * `Zotero.debug`'s default is applied by its own parameter default, and
 * `zotero-types` types the parameter as optional rather than nullable.
 */
export function debug(message: string, level?: ZoteroDebugLevel): void {
  const line = prefixed(message);
  if (level === undefined) {
    Zotero.debug(line);
    return;
  }
  Zotero.debug(line, level);
}

/**
 * Route one already-formatted line to the Mozilla error console and
 * `Zotero.getErrors()`.
 *
 * **This is the facade `P1-T32` item 1 found missing.** `docs/07` §10.3:
 * "`Logger.error()` additionally calls `Zotero.logError()` so the entry reaches
 * the Mozilla error console and `Zotero.getErrors()`" — and `Zotero.logError`
 * was named nowhere in `src/zotero/`, so `LogSink.reportError` had no
 * implementation and the optional call in `src/core/logger.ts` did nothing.
 * The user-visible cost was that an error a bug report asks the user to paste
 * was not in the place the instructions send them.
 *
 * **Not to be confused with {@link reportError} below**, which routes to
 * {@link debug} and therefore to `Zotero.debug` only. That one is the
 * `P0-T10` helper for a caught exception and keeps its two-argument shape for
 * its live callers; this one is the `LogSink` channel.
 *
 * `Zotero.logError` takes an `Error`, not a string (`zotero-types@4.1.3`,
 * `zotero.js`), so the line is wrapped. `Zotero.logError` also emits the line
 * to Debug Output at level 1 itself, which is what §10.3's "additionally"
 * means: an `error()` line appears twice in a debug log, once from
 * {@link debug} and once from here, and only the second reaches
 * `Zotero.getErrors()`.
 */
export function logError(message: string): void {
  Zotero.logError(new Error(prefixed(message)));
}

/**
 * Log a caught error with its stack. Never rethrows.
 *
 * **Reaches `Zotero.debug` only, by design and despite the name.** It is not
 * `LogSink.reportError`'s implementation and must not be wired to it: the
 * signatures differ (one line versus a message and a cause) and, more
 * importantly, this function does not reach the Mozilla error console at all,
 * so wiring it would make `P1-T32`'s first criterion *look* satisfied while
 * the missing channel stayed missing. {@link logError} is that channel.
 */
export function reportError(message: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? "(no stack)"}`
      : String(error);
  debug(`${message}: ${detail}`);
}

/**
 * Resolve once Zotero's item-type/field schema is loaded.
 *
 * `docs/01` §12 gotcha 29 / §5.3: `Zotero.ItemFields.getID()` and
 * `Zotero.ItemTypes.getID()` throw `UnloadedDataException` if called before
 * this settles, and `Zotero.Item.fromJSON()` calls both internally.
 */
export async function schemaReady(): Promise<void> {
  await Zotero.Schema.schemaUpdatePromise;
}

/**
 * The user library's id. `P0-T10`'s spike command wrote into it; since
 * `P7-T04` retired that command no product code calls this, and it is kept as
 * the facade read `src/addon.ts`'s `PlatformReads` note names.
 */
export function userLibraryID(): number {
  return Zotero.Libraries.userLibraryID;
}
/**
 * Turn one of {@link toZoteroItemJSON}'s mappings into an unsaved
 * `Zotero.Item`.
 *
 * This is the platform half of `src/zotero/itemMapper.ts`, and the only half
 * there is: §§2–5 of that module are pure by design and `docs/07` §2.3 makes
 * `src/zotero/` the one directory allowed to name `Zotero.*`. It replaces the
 * `new Zotero.Item()` / `libraryID` / `fromJSON()` / `addTag()` block that
 * `P0-T10`'s `buildJournalArticle()` owned (retired by `P1-T24`), with two
 * differences that are consequences of the shipped mapper rather than choices
 * made here:
 *
 * - **No `addTag()` call.** `toZoteroMapping()` puts the tags — including
 *   `research_helper` at {@link AUTOMATIC_TAG_TYPE} — in the JSON, and
 *   `fromJSON()` applies them. One write instead of two.
 * - **`accessDate`, `extra` and the rest of §6.2's table** are now written,
 *   because the shipped mapper maps the whole table rather than the spike's
 *   four fields.
 *
 * The caller owns the transaction and the `save()` — `docs/01` §5.8's
 * single-writer rule means the decision of *when* to write belongs with the
 * code that knows how many items are coming, not with the mapper. And because
 * `fromJSON()` is a replace and not a merge (`docs/01` §5.2.1 hard rule 1,
 * §12 gotcha 24), the item handed back here must always be a **new** one.
 *
 * @param itemJSON - a mapping from `toZoteroItemJSON()` / `toZoteroMapping()`
 * @param libraryID - the destination library
 * @returns the item, unsaved
 */
export function newItemFromMapping(
  itemJSON: ZoteroItemJSON,
  libraryID: number,
): Zotero.Item {
  const item = new Zotero.Item();
  item.libraryID = libraryID;
  // Ship non-strict, develop strict (docs/01 §5.2.1).
  item.fromJSON(itemJSON, { strict: __env__ === "development" });
  return item;
}

// ---------------------------------------------------------------------------
// `Zotero.Retractions` reads — `P3-T27` step 1
// ---------------------------------------------------------------------------

/** What Zotero's own Retraction Watch data says about one item. */
export interface ZoteroRetraction {
  /** `Zotero.Retractions.isRetracted(item)`: synchronous and free (`docs/06` §13.3). */
  readonly retracted: boolean;
  /**
   * Each reason's description, for Appendix A. Empty when the item is not
   * retracted, when this Zotero has no `getData` / `getReasonDescription`, or
   * when either throws or answers in a shape not recognised.
   */
  readonly reasons: readonly string[];
}

/**
 * The two members `docs/06` §13.3 names by line number but whose parameter
 * and return types it does not give, which is why `typings/zotero-augment.d.ts`
 * declares only `isRetracted`. Read structurally here and feature-detected,
 * never assumed: an unknown shape yields no reason rather than a guess.
 */
interface RetractionReasonReaders {
  getData?: (item: Zotero.Item) => unknown;
  getReasonDescription?: (reason: string) => unknown;
}

/**
 * Read Zotero's own retraction data for `item` (`docs/06` §13.3 layer (a)):
 * the plugin reads what Zotero already holds and never fetches or scrapes
 * Retraction Watch itself.
 *
 * `isRetracted` decides; the reasons are best-effort. **Unverified against a
 * real retracted item** — `getData`'s record is read as an object whose
 * `reasons` member is an array of strings, each passed through
 * `getReasonDescription` when that is a function. Anything else yields no
 * reason, and the item is still reported retracted.
 *
 * @param item - a regular item
 * @returns whether Zotero flags it, and the reason descriptions it gives
 */
export async function readRetraction(
  item: Zotero.Item,
): Promise<ZoteroRetraction> {
  const retracted = Zotero.Retractions.isRetracted(item);
  if (!retracted) return { retracted, reasons: [] };
  const readers = Zotero.Retractions as unknown as RetractionReasonReaders;
  try {
    if (typeof readers.getData !== "function") {
      return { retracted, reasons: [] };
    }
    const data: unknown = await readers.getData(item);
    const raw =
      typeof data === "object" && data !== null
        ? (data as { reasons?: unknown }).reasons
        : undefined;
    if (!Array.isArray(raw)) return { retracted, reasons: [] };
    const reasons: string[] = [];
    for (const reason of raw as unknown[]) {
      if (typeof reason !== "string") continue;
      const described =
        typeof readers.getReasonDescription === "function"
          ? readers.getReasonDescription(reason)
          : undefined;
      reasons.push(
        typeof described === "string" && described !== "" ? described : reason,
      );
    }
    return { retracted, reasons };
  } catch (error) {
    debug(
      `Zotero.Retractions reason lookup failed: ${
        error instanceof Error ? error.name : typeof error
      }`,
    );
    return { retracted, reasons: [] };
  }
}

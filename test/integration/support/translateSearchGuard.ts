/* eslint-disable no-restricted-globals -- the integration suite's own guard: it replaces `Zotero.Translate.Search` on the live platform for every spec, which no src/zotero/ facade exposes (docs/13 §2.3). */
/**
 * The suite-wide stub of `Zotero.Translate.Search` that `plan/00` §6 item 208
 * promised and item 229 (owner, 2026-10-20) ordered.
 *
 * **Why.** On 2026-10-16 an integration mutant switched Strategy B (the
 * translator import path, `src/zotero/translatorImport.ts`) on for the whole
 * suite. Every spec that imports without its own fake then reached Zotero's
 * real translators, and real lookups went out to the services those
 * translators call. Strategy B swallows a failed lookup as a per-record
 * fallback, so such a mistake does not fail a test by itself.
 *
 * **What it does.** `../_suite-guards.spec.ts` installs {@link
 * installTranslateSearchGuard} when its script loads (it sorts first among the
 * suite's files) and registers root-level Mocha hooks, which run around
 * **every** test in **every** spec file. While installed,
 * `Zotero.Translate.Search` is a stub whose constructor records the current
 * test and throws {@link TranslateSearchGuardError}: no translator runs, so no
 * request leaves. The root `afterEach` hook then turns any recorded incident
 * into a test failure, and also fails when a spec left
 * `Zotero.Translate.Search` replaced by something other than this stub.
 *
 * **A spec that wants a translator** passes its own fake through
 * `TranslatorImportOptions.createSearch` (as `translatorImport.spec.ts`
 * does), or swaps the global and puts back what it found. **The one spec that
 * needs the real constructor** — `docs/11` R-1's check that the four methods
 * still exist — asks for it by name through {@link withRealTranslateSearch},
 * which hands the constructor to a synchronous body and never reinstalls it
 * globally.
 *
 * **State lives on the platform, not in this module.** The scaffold bundles
 * each spec file separately (`zotero-plugin-scaffold` 0.9.2's `bundleTests`),
 * so every spec gets its own copy of this module; the shared state is a
 * `Symbol.for` property on the window's global object, and the real
 * constructor is kept on the stub itself.
 */

/** Thrown by the stub's constructor. Its name is the fallback code Strategy B logs. */
export class TranslateSearchGuardError extends Error {
  override readonly name = "TranslateSearchGuardError";
}

const GUARD_STATE = Symbol.for(
  "research_helper.integration.translateSearchGuard",
);
const REAL_CONSTRUCTOR = Symbol.for(
  "research_helper.integration.translateSearchGuard.real",
);

type SearchConstructor = new () => unknown;

interface GuardStub {
  (): never;
  readonly [REAL_CONSTRUCTOR]: unknown;
}

interface GuardState {
  readonly stub: GuardStub;
  readonly real: unknown;
  /** One line per refused construction, not yet reported. */
  incidents: string[];
  /** The running test's full title, set by the root `beforeEach`. */
  currentTest: string;
}

function translateNamespace(): { Search: unknown } {
  return Zotero.Translate as { Search: unknown };
}

function globalState(): GuardState | undefined {
  return (globalThis as Record<symbol, GuardState | undefined>)[GUARD_STATE];
}

function isGuardStub(value: unknown): value is GuardStub {
  return typeof value === "function" && REAL_CONSTRUCTOR in value;
}

/**
 * Replace `Zotero.Translate.Search` with the refusing stub. Idempotent: a
 * second call, or a call on a platform where an earlier run left the stub in
 * place, keeps the real constructor it already holds.
 */
export function installTranslateSearchGuard(): void {
  const namespace = translateNamespace();
  const existing = globalState();
  if (existing !== undefined && namespace.Search === existing.stub) return;
  const current = namespace.Search;
  const real = isGuardStub(current) ? current[REAL_CONSTRUCTOR] : current;
  // The stub reads `state` only when called, after it is filled in below.
  const holder: { state?: GuardState } = {};
  const stub = function GuardedTranslateSearch(): never {
    const currentTest = holder.state?.currentTest ?? "(unknown test)";
    const line =
      `"${currentTest}" constructed Zotero.Translate.Search without ` +
      "installing its own fake";
    holder.state?.incidents.push(line);
    throw new TranslateSearchGuardError(
      `research_helper integration guard (plan/00 §6 items 208, 229): ${line}. ` +
        "Refused: no translator ran and no request was sent. Pass a fake " +
        "through TranslatorImportOptions.createSearch.",
    );
  };
  Object.defineProperty(stub, REAL_CONSTRUCTOR, { value: real });
  const state: GuardState = {
    stub: stub as unknown as GuardStub,
    real,
    incidents: [],
    currentTest: "(outside any test)",
  };
  holder.state = state;
  (globalThis as Record<symbol, GuardState | undefined>)[GUARD_STATE] = state;
  namespace.Search = stub;
}

/** True while `Zotero.Translate.Search` is this guard's stub. */
export function isTranslateSearchGuardInstalled(): boolean {
  const state = globalState();
  return state !== undefined && translateNamespace().Search === state.stub;
}

/** Name the running test, so an incident says where it happened. */
export function setGuardedTest(title: string): void {
  const state = globalState();
  if (state !== undefined) state.currentTest = title;
}

/** The incidents recorded since the last call, which are then cleared. */
export function takeTranslateSearchIncidents(): string[] {
  const state = globalState();
  if (state === undefined) return [];
  const taken = state.incidents;
  state.incidents = [];
  return taken;
}

/**
 * What the root `afterEach` hook checks: an error describing every incident,
 * and a replaced-and-not-restored `Zotero.Translate.Search`, or `undefined`
 * when there is nothing to report.
 */
export function translateSearchGuardViolation(): Error | undefined {
  // One line per distinct incident, with its count: a 100-record import
  // refused 100 times is one line, not a hundred.
  const counts = new Map<string, number>();
  for (const line of takeTranslateSearchIncidents()) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const problems = [...counts].map(([line, count]) =>
    count === 1 ? line : `${line} (${String(count)} times)`,
  );
  if (!isTranslateSearchGuardInstalled()) {
    problems.push(
      "Zotero.Translate.Search is not the suite guard's stub: the guard was " +
        "never installed, or a spec replaced it and did not put back what " +
        "it found",
    );
  }
  if (problems.length === 0) return undefined;
  return new TranslateSearchGuardError(problems.join("\n"));
}

/**
 * Put the real constructor back, at the end of the run, so the platform is
 * left as it was found.
 */
export function uninstallTranslateSearchGuard(): void {
  const state = globalState();
  if (state === undefined) return;
  const namespace = translateNamespace();
  if (namespace.Search === state.stub) namespace.Search = state.real;
  (globalThis as Record<symbol, GuardState | undefined>)[GUARD_STATE] =
    undefined;
}

/**
 * **The escape hatch.** Hands `body` the real `Zotero.Translate.Search`
 * constructor, for `docs/11` R-1's API-surface check, which constructs one
 * search object and calls none of its methods. The global stays the stub
 * throughout, so nothing else can reach a translator meanwhile.
 *
 * `reason` is required and appears in any failure. `body` must be
 * synchronous: a returned promise is refused, because a body that awaits
 * could start a lookup.
 *
 * @throws Error when the guard is not installed — so removing the guard fails
 *   the spec that relies on it
 */
export function withRealTranslateSearch<T>(
  reason: string,
  body: (RealSearch: SearchConstructor) => T,
): T {
  const state = globalState();
  if (state === undefined || !isTranslateSearchGuardInstalled()) {
    throw new Error(
      `withRealTranslateSearch(${JSON.stringify(reason)}): the suite-wide ` +
        "Zotero.Translate.Search guard is not installed " +
        "(test/integration/_suite-guards.spec.ts)",
    );
  }
  if (typeof state.real !== "function") {
    throw new Error(
      `withRealTranslateSearch(${JSON.stringify(reason)}): this Zotero has ` +
        "no Zotero.Translate.Search constructor",
    );
  }
  const value = body(state.real as SearchConstructor);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    throw new Error(
      `withRealTranslateSearch(${JSON.stringify(reason)}): the body must be ` +
        "synchronous",
    );
  }
  return value;
}

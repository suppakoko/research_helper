/**
 * `ProgressReporter` — the contract every progress surface implements.
 *
 * **Scope.** `P1-T02`, **the interface only.** No implementation, no class, no
 * `child()` fan-out arithmetic, no ETA, no sink. `P1-T15` owns all of those and
 * `modify`s this file to add them, together with its `src/zotero/progressWindow.ts`
 * adapter; writing any of them here would take that card's work.
 *
 * The path moved to this card because it had to. `docs/07` §4.2's
 * `LiteratureSource` imports `ProgressReporter` from here, so `src/sources/types.ts`
 * cannot compile without it — yet `P1-T15` sits after `P1-T07`, `P1-T08`,
 * `P1-T09`, `P1-T10` and `P1-T11` in the dependency order, which left
 * `npm run typecheck` unable to reach exit 0 for five consecutive cards. The plan
 * was amended rather than the code: this card `create`s the declaration,
 * `P1-T15` `modify`s it into a working tree of reporters.
 *
 * **Authority.** The interface below is `docs/07-architecture-and-data-model.md`
 * §4.1's `// src/core/jobQueue/progress.ts` block, transcribed verbatim — every
 * member, with §4.1's names, signatures and doc comments. `plan/README.md` §5
 * rule 3 makes §4.1 the sole authority for it.
 *
 * **No repair was needed here**, unlike the `docs/07` §10.1 transcription in
 * `../errors.ts`. §4.1's block declares an `interface`, so there is no class
 * field to acquire a literal type and nothing for `noImplicitOverride` to catch;
 * and its four optional items (`total`, `n`, `detail`, `message`) are optional
 * *parameters*, not optional *properties*, so `tsconfig.json`'s
 * `exactOptionalPropertyTypes` is not engaged. It compiles as printed.
 *
 * **Layering.** `core/` imports `model/` only and names no `Zotero` global
 * (§2.3, enforced by `eslint.config.js`). That is why the `Zotero.ProgressWindow`
 * fan-out the comment below describes lives in `src/zotero/progressWindow.ts`
 * behind this interface, and not in this directory.
 */

/**
 * Progress reporting. Implementations fan out to:
 *  - the persisted JobRecord (throttled),
 *  - the event bus (for UI subscribers),
 *  - Zotero.ProgressWindow (for the transient popup).
 *
 * A reporter is a *tree*: a pipeline creates child reporters per stage so that a
 * stage reporting 0..1 maps into its slice of the parent's range.
 */
export interface ProgressReporter {
  /** Human-readable current step, e.g. "Fetching PubMed page 3 of 8". */
  setMessage(message: string): void;
  /** Absolute progress. total === undefined means indeterminate. */
  setProgress(completed: number, total?: number): void;
  /** Convenience: completed += n. */
  increment(n?: number): void;
  /**
   * Create a sub-reporter occupying [fromFraction, toFraction] of this
   * reporter's range. Weights let stages of unequal cost divide the bar fairly.
   */
  child(
    label: string,
    fromFraction: number,
    toFraction: number,
  ): ProgressReporter;
  /** Non-fatal issue recorded in the JobRecord's warnings, not a popup. */
  warn(message: string, detail?: Record<string, unknown>): void;
  /** Final state; further calls are ignored. */
  done(outcome: "succeeded" | "failed" | "cancelled", message?: string): void;
}

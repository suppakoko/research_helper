/**
 * The single wiring point for literature sources.
 *
 * **Scope.** `P1-T07` step 5: register `pubmed` and nothing else.
 * `docs/07` §11.1 step 8 makes this file the *only* place a new source is wired
 * in — that is what lets step 11 claim "the source appears automatically in the
 * search dialog because it is rendered from the registry", and what keeps
 * `plan/03-phase-2-multi-source-dedup.md`'s six adapter cards additive: each of
 * them `modify`s this file and nothing else in `bootstrap/`.
 *
 * **Why the adapters arrive as an argument.** `src/bootstrap/container.ts`
 * currently ships the *lifetime* half of the composition root (`P0-T07`'s
 * teardown registry) and says in its own header that "the service-locator half
 * is not written yet". There is therefore nothing to resolve an adapter *from*,
 * and a `LiteratureSource` needs the HTTP client (`P1-T05`), the rate limiter
 * (`P1-T04`) and the NCBI secret (`P1-T06`) — three things `P1-T07` does not
 * depend on. So this function takes already-constructed adapters and owns the
 * *policy* (which ids this phase registers, and in what order) rather than the
 * construction. The composition root calls it once.
 *
 * **Phase 1 registers one source, deliberately.** The contract and the registry
 * ship here for all seven (`plan/02-phase-1-pubmed.md` §3, "Six more source
 * adapters … Phase 2 … so Phase 2 is additive, but only `pubmed` is
 * registered"). `openalex` is never registered at all: the id is reserved and
 * out of v1 by decision D2 (`src/model/ids.ts` records the full rule).
 */

import { SOURCE_IDS, type SourceId } from "../model/ids";
import type { SourceRegistry } from "../sources/registry";
import type { LiteratureSource } from "../sources/types";

/**
 * The adapters this build has. One member per source the phase ships, so a
 * missing adapter is a compile error at the call site rather than an empty
 * database row in the search dialog.
 *
 * Phase 2 adds `europepmc`, `crossref`, `semanticscholar`, `arxiv`, `biorxiv`
 * and `medrxiv` here as its adapter cards land.
 */
export interface SourceAdapters {
  /** Phase 1's only adapter. `P1-T09` builds it. */
  readonly pubmed: LiteratureSource;
}

/**
 * Register every adapter in {@link SourceAdapters} into `registry`.
 *
 * Registration order is `SOURCE_IDS` order — the `SourceId` union's declaration
 * order — because `docs/08` §4.2's Databases checkbox row is rendered from the
 * registry and lists the sources in exactly that order. With one adapter the
 * loop is a formality; it is written as a loop so Phase 2's additions inherit
 * the ordering instead of depending on the order someone happens to type the
 * object literal's keys.
 *
 * @param registry - the registry from {@link createSourceRegistry}, empty
 * @param adapters - constructed adapters, supplied by the composition root
 * @throws if an adapter's own `id` does not match the key it was supplied
 *   under — a mis-wired container would otherwise put PubMed's adapter behind
 *   Crossref's checkbox, and `registry.get()` would agree with it
 */
export function registerSources(
  registry: SourceRegistry,
  adapters: SourceAdapters,
): void {
  const byId: Readonly<Partial<Record<SourceId, LiteratureSource>>> = adapters;

  for (const id of SOURCE_IDS) {
    const adapter = byId[id];
    if (adapter === undefined) continue;

    if (adapter.id !== id) {
      throw new Error(
        `[research-helper] the adapter supplied as "${id}" reports id "${adapter.id}". ` +
          `docs/07 §11.1 step 3 makes SourceId the adapter's identity; a mismatch here ` +
          `means the registry, the sources preference and the UI disagree about what was asked.`,
      );
    }

    registry.register(adapter);
  }
}

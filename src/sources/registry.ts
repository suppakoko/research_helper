/**
 * The source registry — the one place that knows which literature databases
 * this build can talk to.
 *
 * **Scope.** `P1-T07` step 2: `register`, `get(id)`, `list()` and
 * `listConfigured()`. Nothing else. The registry is a lookup table, not a
 * planner: deciding *which* registered sources a given run should ask is the
 * pipeline's job (`docs/07` §12.1), and deciding which are *enabled* is the
 * `sources` preference's (`docs/07` §8.5 — "there is no per-source `enabled`
 * boolean; membership in `sources` *is* the enable flag").
 *
 * **Why it exists at all.** Two consumers need to enumerate sources without
 * naming them:
 *
 * - `docs/08` §4.2's Databases checkbox row "is rendered from the source
 *   registry", and §11.1 step 11 makes that the reason adding a source needs no
 *   UI change.
 * - `docs/07` §11.1 step 8 makes registration the single wiring point, which is
 *   what lets `P1-T07` ship the contract for seven sources while Phase 1
 *   registers exactly one (`plan/02-phase-1-pubmed.md` §3).
 *
 * **Layering.** `sources/` imports `core/` and `model/` only (`docs/07` §2.3).
 * This file imports neither beyond the `SourceId` type.
 */

import type { SourceId } from "../model/ids";
import type { LiteratureSource } from "./types";

/**
 * A mutable collection of {@link LiteratureSource} adapters, keyed by
 * {@link SourceId}.
 *
 * Read order is **registration order**, not {@link SourceId} declaration order.
 * `src/bootstrap/registerSources.ts` registers in declaration order precisely
 * so the two coincide and `docs/08` §4.2's checkbox row renders in the order
 * that document lists — the ordering rule lives at the single wiring point
 * rather than being re-derived here on every read.
 */
export interface SourceRegistry {
  /**
   * Add an adapter. Throws if a source with the same `id` is already
   * registered: two adapters for one database means one of them is unreachable
   * and every later `get()` silently resolves to whichever won.
   */
  register(source: LiteratureSource): void;

  /** The adapter for `id`, or `undefined` if this build has none. */
  get(id: SourceId): LiteratureSource | undefined;

  /** Every registered adapter, in registration order. */
  list(): readonly LiteratureSource[];

  /**
   * Every registered adapter whose `isConfigured()` returns `true` — the ones
   * usable *right now*, e.g. because a required credential is present
   * (`docs/07` §4.2).
   *
   * `isConfigured()` is called on every read rather than cached: it reads
   * mutable state (`P1-T06`'s key-presence flag), and a source that becomes
   * configured mid-session must not need a restart to appear.
   */
  listConfigured(): readonly LiteratureSource[];
}

/** Create an empty registry. The composition root fills it exactly once. */
export function createSourceRegistry(): SourceRegistry {
  // A Map, not a plain object: it preserves insertion order for string keys
  // without the prototype-pollution surface of `Record<SourceId, …>` built from
  // untrusted input, and `SourceId` is a closed union so no key is ever absent
  // by accident.
  const sources = new Map<SourceId, LiteratureSource>();

  return {
    register(source: LiteratureSource): void {
      const existing = sources.get(source.id);
      if (existing !== undefined) {
        throw new Error(
          `[research-helper] a literature source is already registered for "${source.id}". ` +
            `docs/07 §11.1 step 8 makes registerSources.ts the single wiring point; ` +
            `registering twice usually means the composition root ran twice.`,
        );
      }
      sources.set(source.id, source);
    },

    get(id: SourceId): LiteratureSource | undefined {
      return sources.get(id);
    },

    list(): readonly LiteratureSource[] {
      return [...sources.values()];
    },

    listConfigured(): readonly LiteratureSource[] {
      return [...sources.values()].filter((source) => source.isConfigured());
    },
  };
}

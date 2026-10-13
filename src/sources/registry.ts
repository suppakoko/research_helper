/**
 * The source registry — the one place that knows which literature databases
 * this build can talk to.
 *
 * **Scope.** `P1-T07` step 2: `register`, `get(id)`, `list()` and
 * `listConfigured()` — plus, since `P2-T26`, one **test seam**,
 * {@link SourceRegistry.replaceForTest}, which no production code calls (the
 * unit test reads the tree and fails if any file under `src/` other than this
 * one names it). Nothing else. The registry is a lookup table, not a
 * planner: deciding *which* registered sources a given run should ask is the
 * pipeline's job (`docs/07` §12.1), and deciding which are *enabled* is the
 * `sources` preference's (`docs/07` §8.5 — "there is no per-source `enabled`
 * boolean; membership in `sources` *is* the enable flag").
 *
 * **Why there is still no `unregister`.** `P1-T35` and `P1-T23` each needed a
 * stand-in source inside a live Zotero and, with `register` the only way in,
 * each took a spare `SourceId` (`crossref`, `europepmc`) and left its stub in
 * the application-wide registry for the rest of the process. Phase 2 ships
 * adapters under both ids, so both registrations would start throwing
 * (`plan/00` §6 item 27). A removal was the first idea; it was not taken
 * because a removed-then-re-registered adapter moves to the **end** of
 * registration order, and `docs/08` §4.2's checkbox row is rendered from that
 * order. A replacement keeps the slot, keeps the id set closed, and gives the
 * caller the displaced adapter back so the swap can be undone — which is all
 * a spec needs.
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

  /**
   * **Test seam, not a lifecycle operation** (`P2-T26`). Put `source` where
   * the adapter with the same `id` currently sits — the same slot in
   * registration order, so `list()` and the checkbox row it renders keep their
   * order — and return the adapter it displaced, so the caller can put that one
   * back with a second call.
   *
   * Throws if nothing is registered under `source.id`. That is what keeps this
   * from being a second way into the registry: the set of registered ids grows
   * only through {@link register}, whose duplicate check stays the only gate,
   * and a spec cannot use this to take a `SourceId` the build ships no adapter
   * for — the mistake it exists to end.
   *
   * Nothing in `src/` calls this, and `test/unit/sources/registry.test.ts`
   * fails if anything there starts to. The startup path
   * (`registerSources` → {@link register}) is unchanged.
   */
  replaceForTest(source: LiteratureSource): LiteratureSource;
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

    replaceForTest(source: LiteratureSource): LiteratureSource {
      const displaced = sources.get(source.id);
      if (displaced === undefined) {
        throw new Error(
          `[research-helper] replaceForTest("${source.id}"): no literature source is registered under that id. ` +
            `The seam swaps an adapter that is already registered; it never registers one — ` +
            `register() and its duplicate check are the only way in.`,
        );
      }
      // `Map.set` on a key that is present keeps the key's insertion position,
      // which is the property the checkbox row's ordering rests on.
      sources.set(source.id, source);
      return displaced;
    },
  };
}

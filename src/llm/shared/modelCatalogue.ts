/**
 * The model catalogue: each configured provider's live model list, enriched
 * with context windows and prices from OpenRouter's public catalogue.
 *
 * **Scope.** `P3-T13` steps 2–3. Callers: the preferences pane host
 * (`P3-T14`, which fills each provider's model menulist from
 * {@link modelsFor} and shows {@link ModelCatalogueSnapshot.asOfEpochMs} and
 * the {@link ModelCatalogueSnapshot.stale} marker) and the cost estimator
 * (`P3-T16`, which prices a run with `./pricing.ts`'s `costOf` on
 * {@link CatalogueModel.prices}). *(Updated 2026-10-23, `plan/00` §6 item
 * 278(b): the composition root builds one catalogue, inside the one
 * {@link ModelPriceSource} (section 5), which the pane's suggestions refresh
 * and the budgeted router's reservations read; the cost dialog, `P3-T29`'s,
 * is to read the same source.)*
 *
 * **What is fetched** (`docs/03` §9 preamble and §9.4):
 * - OpenRouter's catalogue, always: it needs no key, it is the only
 *   machine-readable price source of the four, and it is the metadata source
 *   for every provider. Its entries are also the `openrouter` provider's models.
 * - Each other registered provider's own list, when that provider is
 *   configured (`LLMProviderRegistry.isConfigured`).
 *
 * **Enrichment.** A native model is looked up under `./slugMap.ts`'s
 * `toOpenRouterSlug`. Its own limits win when it states them (a positive
 * number: OpenAI's list states none and uses 0, `P3-T08`); otherwise the
 * catalogue entry's apply. Prices always come from the catalogue entry, with
 * its long-context tiers. With no entry under the slug, every enriched field
 * stays `undefined`: nothing is guessed (`docs/03` §9.4, "degrade gracefully").
 *
 * **Cache.** Each fetched list is one entry in `docs/07` §4.1's `Cache`
 * (`P3-T33`), namespace `source-response` (raw upstream payloads), for
 * {@link MODEL_CATALOGUE_TTL_MS} (24 h, `docs/03` §9). Each entry records its
 * fetch time; a snapshot's "as of" is the oldest fetch time it was built from.
 * A failed fetch is never cached. `LLMCallContext.bypassCache` refetches.
 *
 * **Fallback.** Only when **every** fetch fails, the snapshot is
 * {@link bundledCatalogue}: `./pricing.ts`'s `DOCUMENTED_PRICE_TABLE` (the
 * `docs/03` §12.1 table of 2026-09-08), with `stale: true` and that date as
 * its "as of". Its model IDs and prices are not claimed to be current; that
 * check is the owner's, at gate `G-18`.
 *
 * **User prices.** {@link ModelCatalogueDeps.userPriceOverrides} is applied
 * last, live and bundled alike. *Updated 2026-10-21 (`plan/00` §6 item 265
 * (b), owner):* the table is stored in the plugin database's `user_price`
 * (`docs/07` §8.3), not in a preference; the composition root passes
 * `() => graph.database.prices.list()` (`./pricing.ts`'s `UserPriceStore`).
 * A read that fails is logged and the snapshot keeps the catalogue's prices.
 */

import type { Cache, CacheNamespace } from "../../core/cache/cache";
import { cacheKey } from "../../core/cache/keys";
import type { Clock } from "../../core/clock";
import { OperationCancelledError } from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { ProviderId } from "../../model/ids";
import type { OpenRouterCatalogueEntry } from "../openrouter/catalogue";
import type { LLMProviderRegistry } from "../registry";
import type { LLMCallContext, ModelInfo } from "../types";

import {
  applyUserPriceOverride,
  DOCUMENTED_PRICE_TABLE,
  DOCUMENTED_PRICES_AS_OF_EPOCH_MS,
  findUserPriceOverride,
  pricesFromCatalogueEntry,
  pricesFromDocumentedRow,
  type ModelPrices,
  type UserPriceOverride,
  type UserPriceStore,
} from "./pricing";
import { toOpenRouterSlug } from "./slugMap";

// ---------------------------------------------------------------------------
// 1. Types and constants
// ---------------------------------------------------------------------------

/** One model as the picker and the estimator see it. */
export interface CatalogueModel {
  readonly providerId: ProviderId;
  /** The ID to send as `ChatRequest.model` to `providerId`. */
  readonly id: string;
  readonly displayName: string;
  /** The OpenRouter slug it was looked up under. */
  readonly openRouterSlug: string | undefined;
  /** `undefined`: neither the provider nor the OpenRouter catalogue states it. */
  readonly contextWindowTokens: number | undefined;
  readonly maxOutputTokens: number | undefined;
  /** `undefined`: no price is known for this model. */
  readonly prices: ModelPrices | undefined;
}

/** What {@link ModelCatalogue.get} returns. */
export interface ModelCatalogueSnapshot {
  readonly models: readonly CatalogueModel[];
  /** The oldest fetch time this snapshot rests on; the documented date when stale. */
  readonly asOfEpochMs: number;
  /** True only for the bundled fallback list: every fetch failed. */
  readonly stale: boolean;
  /** The parts that could not be fetched this time. */
  readonly failed: readonly CataloguePart[];
}

/**
 * One fetched list, named by provider: a provider's own list, and for
 * `openrouter` its public catalogue (which is also that provider's list).
 */
export type CataloguePart = ProviderId;

/** What {@link createModelCatalogue} needs. */
export interface ModelCatalogueDeps {
  /** Which adapters exist and which are configured. */
  readonly registry: Pick<LLMProviderRegistry, "list" | "isConfigured">;
  /**
   * OpenRouter's public catalogue, overrides included: the OpenRouter
   * adapter's `listCatalogue` (`P3-T07`).
   */
  readonly openRouterCatalogue: (
    ctx: LLMCallContext,
  ) => Promise<readonly OpenRouterCatalogueEntry[]>;
  readonly cache: Cache;
  readonly clock: Clock;
  /**
   * The user-editable price table, read once per {@link ModelCatalogue.get}.
   * Defaults to none. In the product it is the plugin database's store,
   * `UserPriceStore.list` (asynchronous); a rejection is logged and read as
   * an empty table.
   */
  readonly userPriceOverrides?: () =>
    readonly UserPriceOverride[] | Promise<readonly UserPriceOverride[]>;
  readonly logger?: Logger;
}

/** The catalogue service. */
export interface ModelCatalogue {
  /** A snapshot: from the cache, or fetched; the bundled list if every fetch fails. */
  get(ctx: LLMCallContext): Promise<ModelCatalogueSnapshot>;
}

/** `docs/03` §9: "cache … with a TTL (24 h is reasonable)". */
export const MODEL_CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;

/** `docs/07` §4.1: raw upstream payloads. */
export const MODEL_CATALOGUE_NAMESPACE: CacheNamespace = "source-response";

/**
 * The cache key of one part.
 *
 * @param part - a provider's list, or OpenRouter's catalogue
 * @returns the key
 */
export function modelCatalogueCacheKey(part: CataloguePart): string {
  return cacheKey("model-catalogue", part);
}

/** A cached native list. */
interface NativeListValue {
  readonly fetchedAtEpochMs: number;
  readonly models: readonly ModelInfo[];
}

/** The cached OpenRouter catalogue. */
interface OpenRouterValue {
  readonly fetchedAtEpochMs: number;
  readonly entries: readonly OpenRouterCatalogueEntry[];
}

// ---------------------------------------------------------------------------
// 2. Reading a snapshot
// ---------------------------------------------------------------------------

/**
 * The models listed for one provider, in the order they were listed.
 *
 * @param snapshot - a catalogue snapshot
 * @param providerId - the provider whose menulist is being filled
 * @returns its models
 */
export function modelsFor(
  snapshot: ModelCatalogueSnapshot,
  providerId: ProviderId,
): readonly CatalogueModel[] {
  return snapshot.models.filter((model) => model.providerId === providerId);
}

/**
 * One model, by provider and ID.
 *
 * @param snapshot - a catalogue snapshot
 * @param providerId - the provider it is called through
 * @param modelId - the ID as `ChatRequest.model` carries it
 * @returns the model, or `undefined` when the snapshot does not list it
 */
export function findCatalogueModel(
  snapshot: ModelCatalogueSnapshot,
  providerId: ProviderId,
  modelId: string,
): CatalogueModel | undefined {
  return snapshot.models.find(
    (model) => model.providerId === providerId && model.id === modelId,
  );
}

// ---------------------------------------------------------------------------
// 3. Assembly
// ---------------------------------------------------------------------------

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function withUserPrices(
  model: CatalogueModel,
  overrides: readonly UserPriceOverride[],
): CatalogueModel {
  const override = findUserPriceOverride(overrides, model.providerId, model.id);
  if (override === undefined) return model;
  return {
    ...model,
    prices: applyUserPriceOverride(model.prices, override),
  };
}

function fromOpenRouterEntry(
  entry: OpenRouterCatalogueEntry,
  fetchedAtEpochMs: number,
): CatalogueModel {
  return {
    providerId: "openrouter",
    id: entry.model.id,
    displayName: entry.model.displayName,
    openRouterSlug: entry.model.id,
    contextWindowTokens: positive(entry.model.contextWindowTokens),
    maxOutputTokens: positive(entry.model.maxOutputTokens),
    prices: pricesFromCatalogueEntry(entry, fetchedAtEpochMs),
  };
}

function fromNativeModel(
  providerId: ProviderId,
  model: ModelInfo,
  openRouter: OpenRouterValue | undefined,
  bySlug: ReadonlyMap<string, OpenRouterCatalogueEntry>,
): CatalogueModel {
  const slug = toOpenRouterSlug(providerId, model.id);
  const entry = slug === undefined ? undefined : bySlug.get(slug);
  return {
    providerId,
    id: model.id,
    displayName: model.displayName,
    openRouterSlug: slug,
    contextWindowTokens:
      positive(model.contextWindowTokens) ??
      positive(entry?.model.contextWindowTokens),
    maxOutputTokens:
      positive(model.maxOutputTokens) ?? positive(entry?.model.maxOutputTokens),
    prices:
      entry === undefined || openRouter === undefined
        ? undefined
        : pricesFromCatalogueEntry(entry, openRouter.fetchedAtEpochMs),
  };
}

/**
 * The bundled fallback list: `docs/03` §12.1's rows under each native
 * provider and, through the slug map, under OpenRouter. Limits are unknown;
 * prices are the documented ones, dated 2026-09-08. `stale` is always true.
 *
 * @param overrides - the user-editable price table
 * @param failed - the parts whose fetch failed, for the snapshot
 * @returns the stale snapshot
 */
export function bundledCatalogue(
  overrides: readonly UserPriceOverride[] = [],
  failed: readonly CataloguePart[] = [],
): ModelCatalogueSnapshot {
  const natives: CatalogueModel[] = [];
  const viaOpenRouter: CatalogueModel[] = [];
  for (const documented of DOCUMENTED_PRICE_TABLE) {
    const prices = pricesFromDocumentedRow(documented);
    const slug = toOpenRouterSlug(documented.providerId, documented.modelId);
    natives.push({
      providerId: documented.providerId,
      id: documented.modelId,
      displayName: documented.modelId,
      openRouterSlug: slug,
      contextWindowTokens: undefined,
      maxOutputTokens: undefined,
      prices,
    });
    if (slug !== undefined) {
      viaOpenRouter.push({
        providerId: "openrouter",
        id: slug,
        displayName: slug,
        openRouterSlug: slug,
        contextWindowTokens: undefined,
        maxOutputTokens: undefined,
        prices,
      });
    }
  }
  return {
    models: [...viaOpenRouter, ...natives].map((model) =>
      withUserPrices(model, overrides),
    ),
    asOfEpochMs: DOCUMENTED_PRICES_AS_OF_EPOCH_MS,
    stale: true,
    failed,
  };
}

// ---------------------------------------------------------------------------
// 4. The service
// ---------------------------------------------------------------------------

function isFetchedValue(
  value: unknown,
  listKey: "models" | "entries",
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.fetchedAtEpochMs === "number" &&
    Number.isFinite(record.fetchedAtEpochMs) &&
    Array.isArray(record[listKey])
  );
}

/**
 * Build the catalogue service.
 *
 * @param deps - see {@link ModelCatalogueDeps}
 * @returns the service
 */
export function createModelCatalogue(deps: ModelCatalogueDeps): ModelCatalogue {
  const inFlight = new Map<string, Promise<unknown>>();

  /** One part: from the cache, else fetched and cached. Throws when the fetch fails. */
  async function part<T extends NativeListValue | OpenRouterValue>(
    name: CataloguePart,
    listKey: "models" | "entries",
    fetch: () => Promise<T>,
    ctx: LLMCallContext,
  ): Promise<T> {
    const key = modelCatalogueCacheKey(name);
    if (ctx.bypassCache !== true) {
      const cached = await deps.cache.get<T>(MODEL_CATALOGUE_NAMESPACE, key);
      if (cached !== undefined && isFetchedValue(cached, listKey)) {
        return cached;
      }
    }
    const pending = inFlight.get(key) as Promise<T> | undefined;
    if (pending !== undefined) return pending;
    const fetching = (async (): Promise<T> => {
      const value = await fetch();
      await deps.cache.set(MODEL_CATALOGUE_NAMESPACE, key, value, {
        ttlMs: MODEL_CATALOGUE_TTL_MS,
        tags: [`provider:${name}`],
      });
      return value;
    })();
    inFlight.set(key, fetching);
    try {
      return await fetching;
    } finally {
      inFlight.delete(key);
    }
  }

  function fetchFailed(name: CataloguePart, error: unknown): void {
    if (error instanceof OperationCancelledError) throw error;
    deps.logger?.warn("model catalogue: a list could not be fetched", {
      part: name,
      error: error instanceof Error ? error.name : typeof error,
    });
  }

  /** The user table; a failed read is logged and leaves it empty. */
  async function readUserPrices(): Promise<readonly UserPriceOverride[]> {
    if (deps.userPriceOverrides === undefined) return [];
    try {
      return await deps.userPriceOverrides();
    } catch (error) {
      deps.logger?.warn(
        "model catalogue: the user price table could not be read",
        {
          error: error instanceof Error ? error.name : typeof error,
        },
      );
      return [];
    }
  }

  return {
    async get(ctx: LLMCallContext): Promise<ModelCatalogueSnapshot> {
      ctx.token.throwIfCancelled();
      const overrides = await readUserPrices();
      const failed: CataloguePart[] = [];

      const natives = deps.registry
        .list()
        .filter(
          (provider) =>
            provider.id !== "openrouter" &&
            deps.registry.isConfigured(provider.id),
        );

      const openRouterPromise = part<OpenRouterValue>(
        "openrouter",
        "entries",
        async () => {
          const entries = await deps.openRouterCatalogue(ctx);
          return { fetchedAtEpochMs: deps.clock.now(), entries };
        },
        ctx,
      ).catch((error: unknown) => {
        fetchFailed("openrouter", error);
        failed.push("openrouter");
        return undefined;
      });

      const nativePromises = natives.map((provider) =>
        part<NativeListValue>(
          provider.id,
          "models",
          async () => {
            const models = await provider.listModels(ctx);
            return { fetchedAtEpochMs: deps.clock.now(), models };
          },
          ctx,
        ).catch((error: unknown) => {
          fetchFailed(provider.id, error);
          failed.push(provider.id);
          return undefined;
        }),
      );

      // One `Promise.all`, so a cancellation from either side settles both.
      const [openRouter, nativeLists] = await Promise.all([
        openRouterPromise,
        Promise.all(nativePromises),
      ]);
      failed.sort();

      const fetchTimes: number[] = [];
      if (openRouter !== undefined)
        fetchTimes.push(openRouter.fetchedAtEpochMs);
      for (const list of nativeLists) {
        if (list !== undefined) fetchTimes.push(list.fetchedAtEpochMs);
      }
      if (fetchTimes.length === 0) {
        deps.logger?.warn(
          "model catalogue: every fetch failed; serving the bundled list, marked stale",
          { failed: [...failed] },
        );
        return bundledCatalogue(overrides, failed);
      }

      const bySlug = new Map<string, OpenRouterCatalogueEntry>();
      for (const entry of openRouter?.entries ?? []) {
        bySlug.set(entry.model.id, entry);
      }
      const models: CatalogueModel[] = [];
      if (openRouter !== undefined) {
        for (const entry of openRouter.entries) {
          models.push(fromOpenRouterEntry(entry, openRouter.fetchedAtEpochMs));
        }
      }
      natives.forEach((provider, index) => {
        for (const model of nativeLists[index]?.models ?? []) {
          models.push(fromNativeModel(provider.id, model, openRouter, bySlug));
        }
      });

      return {
        models: models.map((model) => withUserPrices(model, overrides)),
        asOfEpochMs: Math.min(...fetchTimes),
        stale: false,
        failed,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 5. The price snapshot (owner, 2026-10-23, `plan/00` §6 item 278(b))
// ---------------------------------------------------------------------------

/**
 * `snapshot` with `overrides` applied to every model it lists, exactly as
 * {@link createModelCatalogue} applies them. `applyUserPriceOverride`
 * replaces a model's prices wholesale, so applying the same table twice
 * changes nothing.
 *
 * @param snapshot - a catalogue snapshot
 * @param overrides - the user-editable price table
 * @returns the snapshot with the user's prices
 */
export function applyUserPrices(
  snapshot: ModelCatalogueSnapshot,
  overrides: readonly UserPriceOverride[],
): ModelCatalogueSnapshot {
  if (overrides.length === 0) return snapshot;
  return {
    ...snapshot,
    models: snapshot.models.map((model) => withUserPrices(model, overrides)),
  };
}

/**
 * The prices a reservation and the cost dialog read: **one snapshot, read
 * synchronously, refreshed asynchronously** (`docs/07` §4.3's note of
 * 2026-10-23, `plan/00` §6 item 278(b)).
 *
 * The budgeted router's `pricesFor` is synchronous and the catalogue is not,
 * so the source holds the last catalogue snapshot it adopted, with the user
 * price table applied over it. Until one has been adopted it holds
 * {@link bundledCatalogue} — `docs/03` §12.1's documented table — with the
 * user table applied over that. Nothing here fetches on its own: startup
 * sends no catalogue request (`plan/00` §6 item 279(c)).
 */
export interface ModelPriceSource {
  /**
   * `modelId` as `providerId` lists it, in the snapshot held now.
   *
   * @returns its prices, or `undefined` when the snapshot lists it with none
   *   or does not list it (the call is then unpriced)
   */
  pricesFor(providerId: ProviderId, modelId: string): ModelPrices | undefined;
  /** The snapshot {@link pricesFor} reads now, user prices applied. */
  current(): ModelCatalogueSnapshot;
  /**
   * Whether a catalogue snapshot has been adopted; `false` while the source
   * still serves the documented table it started with.
   */
  readonly loaded: boolean;
  /**
   * Read the user price table and the catalogue (its cache, else the
   * network, else its bundled fallback), adopt both, and return the
   * snapshot adopted. A snapshot that arrives after a later refresh's is not
   * adopted. Rejects only when `ctx` is cancelled.
   */
  refresh(ctx: LLMCallContext): Promise<ModelCatalogueSnapshot>;
  /**
   * Re-read the user price table only — the plugin database, no network —
   * and apply it to the snapshot held. A failed read is logged and keeps the
   * table held before.
   */
  reloadUserPrices(): Promise<void>;
}

/** What {@link createModelPriceSource} needs. */
export interface ModelPriceSourceDeps {
  /**
   * The catalogue, built **without** `userPriceOverrides`: the source applies
   * the user table itself, so a row the user removes stops applying at once.
   */
  readonly catalogue: ModelCatalogue;
  /** The user-editable price table (`UserPriceStore.list` in the product). */
  readonly userPriceOverrides: () =>
    readonly UserPriceOverride[] | Promise<readonly UserPriceOverride[]>;
  readonly logger?: Logger;
}

/**
 * Build the one price source of a plugin lifetime.
 *
 * @param deps - see {@link ModelPriceSourceDeps}
 * @returns the source, holding the documented table until a refresh
 */
export function createModelPriceSource(
  deps: ModelPriceSourceDeps,
): ModelPriceSource {
  let base: ModelCatalogueSnapshot = bundledCatalogue();
  let loaded = false;
  let overrides: readonly UserPriceOverride[] = [];
  let held: ModelCatalogueSnapshot = base;
  /** The newest refresh started, and the newest whose snapshot was adopted. */
  let started = 0;
  let adopted = 0;
  /** The same two counters for the user table's reads. */
  let readsStarted = 0;
  let readAdopted = 0;

  const rebuild = (): void => {
    held = applyUserPrices(base, overrides);
  };

  async function readOverrides(): Promise<void> {
    const ticket = ++readsStarted;
    let rows: readonly UserPriceOverride[];
    try {
      rows = await deps.userPriceOverrides();
    } catch (error) {
      deps.logger?.warn(
        "model prices: the user price table could not be read; the table held before stays",
        { error: error instanceof Error ? error.name : typeof error },
      );
      return;
    }
    if (ticket < readAdopted) return;
    readAdopted = ticket;
    overrides = rows;
    rebuild();
  }

  return {
    pricesFor(providerId, modelId) {
      return findCatalogueModel(held, providerId, modelId)?.prices;
    },
    current: () => held,
    get loaded(): boolean {
      return loaded;
    },
    async refresh(ctx) {
      const ticket = ++started;
      const [snapshot] = await Promise.all([
        deps.catalogue.get(ctx),
        readOverrides(),
      ]);
      if (ticket >= adopted) {
        adopted = ticket;
        base = snapshot;
        loaded = true;
        rebuild();
      }
      return applyUserPrices(snapshot, overrides);
    },
    reloadUserPrices: readOverrides,
  };
}

/**
 * `store` with `source` re-reading the user price table after each change
 * it makes (owner, 2026-10-23, `plan/00` §6 item 278(b)), so the next
 * reservation is priced as the user just said. The pane's price form writes
 * through it. The re-read is awaited and never rejects: a failed re-read is
 * logged by the source, which keeps the table it held.
 *
 * @param store - the `user_price` store
 * @param source - the price source to refresh
 * @returns the same store surface
 */
export function reloadingUserPriceStore(
  store: UserPriceStore,
  source: Pick<ModelPriceSource, "reloadUserPrices">,
): UserPriceStore {
  return {
    list: () => store.list(),
    upsert: async (row) => {
      await store.upsert(row);
      await source.reloadUserPrices();
    },
    delete: async (providerId, modelId) => {
      await store.delete(providerId, modelId);
      await source.reloadUserPrices();
    },
  };
}

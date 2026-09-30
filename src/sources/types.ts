/**
 * The `LiteratureSource` contract — the one shape every literature database
 * adapter implements.
 *
 * **Scope.** `P1-T07`. This file is `docs/07-architecture-and-data-model.md`
 * §4.2 transcribed: interface names, member names, types, optionality and doc
 * comments unchanged. `plan/README.md` §5 rule 3 makes doc 07 the sole
 * authority for types, and `docs/02` §12.1 carries an explicit "doc 07 wins"
 * note over its own shorter-named `QueryNode` / `QueryField` sketch
 * (`op`/`text`, `titleAbstract`, `venue`, `all`) — that sketch is deliberately
 * **not** transcribed. Read §12.1 for *what the AST has to express and how each
 * database renders it*; take the names from here.
 *
 * **What `P1-T07` deliberately does not add.** `docs/07` §11.1 closes with the
 * rule that if a pipeline change needs something this interface cannot say,
 * "the `LiteratureSource` interface is wrong and should be extended rather than
 * worked around" — as a documented change to doc 07, not as a local addition.
 * So there is no member here that §4.2 does not declare, and the three optional
 * members (`findRelated`, `lookup`, `fetchAbstract`) are declared but
 * implemented by nobody in Phase 1.
 *
 * **Layering.** `sources/` may import `core/` and `model/` and must not import
 * `pipeline/`, `ui/` or `zotero/` (`docs/07` §2.3, and §4.2's own comment on
 * {@link LiteratureSource}). `eslint.config.js` enforces the first two
 * mechanically; see `P1-T07`'s reported findings for the `zotero/` half, which
 * that config does not yet cover.
 *
 * ## Two transcription notes
 *
 * 1. **`ExternalIds` is imported from `model/ids`, not from
 *    `model/canonicalWork`.** §4.2's import block reads
 *    `import type { CanonicalWork, ExternalIds } from "../model/canonicalWork"`,
 *    but §5.1 — the declaration, and therefore the authority — puts
 *    `ExternalIds` in `src/model/ids.ts`, which is where `P1-T01` shipped it and
 *    where §5.1's own code block places it. `canonicalWork.ts` imports the type
 *    rather than re-exporting it, so §4.2's specifier does not resolve. Same
 *    defect class as the §2.2 directory comment `P1-T01` recorded; §5.1 wins.
 *
 * 2. **`src/core/jobQueue/progress.ts` — resolved 2026-09-30; this note is kept
 *    because the defect it records was real.** When this file was written that
 *    path did not exist: `plan/02-phase-1-pubmed.md` gave it to **`P1-T15`** as
 *    a `create`, while `P1-T07`, `P1-T08`, `P1-T09`, `P1-T10` and `P1-T11` all
 *    precede `P1-T15` and all need it — so `npm run typecheck` could not have
 *    reached exit 0 for five consecutive cards. The import below was left
 *    unresolved deliberately rather than dropping `SourceCallContext.progress`
 *    (§4.2's member, and criterion 1) or re-declaring `ProgressReporter` inside
 *    `sources/` (a parallel copy of a `core/` type). **The plan was corrected
 *    rather than the code:** the §4.1 interface transcription moved into
 *    `P1-T02`'s `Files`, `P1-T15`'s entry for the path became `modify` (it adds
 *    `CompositeProgressReporter`, `child()` and the ETA), and `P1-T02` joined
 *    this card's `Depends on` — which it should always have been, since §4.2
 *    imports `CancellationToken` from `P1-T02` too. The import now resolves.
 */

import type { CancellationToken } from "../core/jobQueue/cancellation";
import type { ProgressReporter } from "../core/jobQueue/progress";
import type { CanonicalWork } from "../model/canonicalWork";
import type { ExternalIds, SourceId } from "../model/ids";
import type { SourceRecord } from "../model/sourceRecord";

/**
 * `SourceId` is declared in `model/ids.ts` (§2.3, §5.1) because model types reference it.
 * Imported above and re-exported here so adapter code has one obvious import.
 */
export type { SourceId };

/** What a given adapter can actually do. The orchestrator plans around this. */
export interface SourceCapabilities {
  /** Free-text/boolean keyword search. */
  readonly keywordSearch: boolean;
  /** "More like this" from an identifier or a work. */
  readonly relatedByWork: boolean;
  /** Fetch a work by DOI / PMID / arXiv ID. */
  readonly lookupById: readonly (keyof ExternalIds)[];
  /** Returns abstracts in search results (vs. requiring a second call). */
  readonly abstractsInSearch: boolean;
  /** Returns references / citations edges. */
  readonly citationGraph: boolean;
  /** Server-side date filtering (otherwise we filter client-side). */
  readonly dateFilter: boolean;
  /** Max page size the API accepts. */
  readonly maxPageSize: number;
  /** Hard ceiling on total results the API will paginate through, if any. */
  readonly maxTotalResults: number | undefined;
  /** True if an API key materially raises limits (surface this in prefs UI). */
  readonly benefitsFromApiKey: boolean;
}

export interface SourceQuery {
  /** Normalized query AST; each adapter renders it into its own syntax. */
  readonly terms: QueryNode;
  /** Inclusive publication-date lower bound (ISO date). */
  readonly fromDate?: string;
  readonly toDate?: string;
  /** Desired number of results from THIS source. */
  readonly limit: number;
  /** Opaque continuation from a previous page. */
  readonly cursor?: string;
  /** ISO-639-1 language filter where supported. */
  readonly languages?: readonly string[];
  /** Restrict to open-access / free-full-text where supported. */
  readonly openAccessOnly?: boolean;
  /** Source-specific escape hatch; documented per adapter. */
  readonly raw?: Record<string, string | number | boolean>;
}

export type QueryNode =
  | { kind: "term"; value: string; field?: QueryField; phrase?: boolean }
  | { kind: "and"; children: readonly QueryNode[] }
  | { kind: "or"; children: readonly QueryNode[] }
  | { kind: "not"; child: QueryNode };

export type QueryField =
  | "title"
  | "abstract"
  | "titleOrAbstract"
  | "author"
  | "journal"
  | "affiliation"
  | "meshTerm"
  | "any";

export interface SourcePage {
  readonly records: readonly SourceRecord[];
  /** Total matches reported by the server, if it reports one. */
  readonly totalAvailable: number | undefined;
  /** Pass back as SourceQuery.cursor. Undefined = no more pages. */
  readonly nextCursor: string | undefined;
  /** Warnings that should reach the job's warning list but not fail the job. */
  readonly warnings: readonly string[];
}

export interface RelatedQuery {
  /** The seed. At least one of `ids` or `work` is required. */
  readonly ids?: Partial<ExternalIds>;
  readonly work?: CanonicalWork;
  readonly limit: number;
  readonly fromDate?: string;
  /** How the caller wants relatedness computed, if the source offers a choice. */
  readonly strategy?:
    "citations" | "references" | "cocitation" | "embedding" | "auto";
}

export interface SourceCallContext {
  readonly token: CancellationToken;
  readonly progress?: ProgressReporter;
  /** Set when the caller wants a fresh fetch regardless of cache. */
  readonly bypassCache?: boolean;
}

/**
 * One literature database. Implementations are stateless apart from injected
 * infrastructure and MUST NOT import anything from `pipeline/`, `ui/` or `zotero/`.
 */
export interface LiteratureSource {
  readonly id: SourceId;
  /** Fluent message ID for the display name; never a hard-coded string. */
  readonly displayNameKey: string;
  readonly capabilities: SourceCapabilities;
  /** Host used to select the shared per-host RateLimiter. */
  readonly rateLimitKey: string;

  /** True if the source is usable right now (e.g. required key present). */
  isConfigured(): boolean;
  /**
   * Lightweight liveness/credential check for the preference pane.
   * Must not consume meaningful quota.
   */
  healthCheck(ctx: SourceCallContext): Promise<SourceHealth>;

  /** Single page of keyword search results. Throws SourceError subclasses. */
  search(query: SourceQuery, ctx: SourceCallContext): Promise<SourcePage>;
  /** Convenience: paginate `search` until `limit` or exhaustion. */
  searchAll(
    query: SourceQuery,
    ctx: SourceCallContext,
  ): AsyncIterable<SourceRecord>;

  /** Only meaningful when capabilities.relatedByWork is true. */
  findRelated?(
    query: RelatedQuery,
    ctx: SourceCallContext,
  ): Promise<SourcePage>;

  /** Batch lookup by external identifier. Order of results is not guaranteed. */
  lookup?(
    ids: readonly Partial<ExternalIds>[],
    ctx: SourceCallContext,
  ): Promise<readonly SourceRecord[]>;

  /**
   * Fetch an abstract for a record that came back without one.
   * Kept separate so the planner can decide whether the extra call is worth it.
   */
  fetchAbstract?(
    ids: Partial<ExternalIds>,
    ctx: SourceCallContext,
  ): Promise<string | undefined>;

  /** Render the normalized query into this source's native syntax (for UI preview + logs). */
  explainQuery(query: SourceQuery): string;
}

export interface SourceHealth {
  readonly ok: boolean;
  readonly messageKey: string;
  readonly latencyMs: number;
  readonly quotaHint?: string;
}

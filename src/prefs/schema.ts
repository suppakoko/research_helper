/**
 * The typed preference schema (`P1-T03` step 1).
 *
 * **`docs/07-architecture-and-data-model.md` §8.5 is the sole authority** for
 * every key, type, default and allowed-value set below, and §8.5.1 is the
 * authority for {@link PrefDef}'s shape. This file restates nothing it does not
 * transcribe, and `plan/README.md` §5 rule 3 makes that non-negotiable: `docs/02`
 * and `docs/03` carry divergent working-name sketches of related types, each
 * carrying a "doc 07 wins" note.
 *
 * **Phase 1's twelve rows, and no others.** §8.5 declares 59 rows. `P1-T03`'s
 * **Read first** names the subset this phase reads — the whole "Sources & search"
 * block plus `timeoutSeconds`, `logLevel`, `logRequestBodies`, `ncbi.keyPresent`,
 * `secretBackend` and `prefsSchemaVersion` — and its **Do NOT** is explicit: "do
 * not add a preference that `docs/07` §8.5 does not declare, and do not change a
 * default". Later phases add their own rows; the ordering rule §8.5 states is
 * *§8.5 first, then `prefs.js`, then the pane*.
 *
 * ## D5, and what the `secret` flag is for
 *
 * **No entry in {@link PREFS} carries `secret: true`, and none ever may.** That
 * is the whole point of the flag: §8.5's closing paragraph requires "a unit test
 * asserts that no `secret: true` entry has a `Zotero.Prefs` writer", and
 * `docs/09` §1.7 refuses tier 4 (plaintext prefs) outright — "implementing it as
 * a fallback guarantees it becomes the common case". Because every member of
 * `PREFS` is reachable from `setPref`, a `secret: true` member would *be* a
 * writer, so the assertion reduces to "no member is secret".
 *
 * The flag is nonetheless declared, for two live consumers: §10.4's debug bundle
 * replaces a secret-flagged value with `"[present]"` / `"[absent]"` in
 * `settings.json`, and `src/prefs/index.ts`'s write guard refuses one
 * structurally rather than by review. `test/unit/prefs/schema.test.ts` exercises
 * that guard against a synthetic secret definition, which is how the criterion
 * "the D5 test fails if a `secret: true` entry is added with a writer" is made
 * mechanical.
 *
 * What *is* a preference, per §8.5's last block: presence booleans
 * (`ncbi.keyPresent`), the selected backend (`secretBackend`), validation
 * timestamps and results, and every non-secret setting. Keys themselves go
 * through `Zotero.OSKeyStore` + `Services.logins` (`src/zotero/keychain.ts`).
 */

import { PREF_KEYS } from "./keys";

/**
 * One preference's declaration — `docs/07` §8.5.1's interface, verbatim.
 *
 * @typeParam T - the value type this preference holds
 */
export interface PrefDef<T> {
  /** Branch-relative key, e.g. "summary.fullTextMode". */
  readonly key: string;
  readonly type: "boolean" | "integer" | "number" | "string";
  readonly default: T;
  /** Closed value set, where §8.5 gives one. */
  readonly values?: readonly T[];
  /** Inclusive numeric bounds, where §8.5 gives them. */
  readonly min?: number;
  readonly max?: number;
  /** D5: never true for anything a Zotero.Prefs writer can reach. */
  readonly secret?: boolean;
}

/**
 * Every preference Phase 1 reads, one entry per `docs/07` §8.5 row.
 *
 * The property name is what plugin code passes to `getPref`; `key` is the
 * branch-relative preference, and the two differ inside a dotted family
 * (`ncbiKeyPresent` → `"ncbi.keyPresent"`), which is §8.5.1's own convention for
 * `fullTextMode` → `"summary.fullTextMode"`. Key strings come from
 * `./keys.ts` so that a typo is a compile error rather than a silently-absent
 * preference.
 *
 * `min` / `max` are **inclusive** and are *not* clamped on read: §8.5.1 says
 * `coerce()` returns "the schema default when the value is absent, the wrong
 * type, **or out of range**", so a stored `searchYears` of `99` yields `3`, not
 * `20`. `P1-T03` step 3 states it as an acceptance criterion.
 *
 * `step` is deliberately absent even though §8.5 gives one for `maxResults`
 * (10) and `timeoutSeconds` (10). {@link PrefDef} declares no `step` member, a
 * step is a *widget* increment rather than a validity rule, and rejecting a
 * stored `maxResults` of `55` would discard a value a user can legitimately set
 * through `about:config`. `docs/08` §7.3's `<html:input>` owns the increment.
 */
export const PREFS = {
  // -------------------------------------------------------------------------
  // Sources & search — docs/07 §8.5, "Sources & search"
  // -------------------------------------------------------------------------

  /**
   * Comma-separated source IDs. Default is **all seven v1 sources** (decision
   * D2): an earlier draft of §8.5's row shipped five and silently dropped both
   * preprint servers. `openalex` is not a valid member — OpenAlex is out of v1.
   *
   * No `values`: §8.5 gives the shape ("comma-separated source IDs, from the
   * `SourceId` union (§5.1) minus `openalex`") rather than a closed set of whole
   * strings, and a closed set here would reject every combination but the
   * default. Membership in this list *is* each source's enable flag — §8.5 is
   * explicit that "there is no per-source `enabled` boolean".
   */
  sources: {
    key: PREF_KEYS.sources,
    type: "string",
    default: "pubmed,europepmc,crossref,semanticscholar,arxiv,biorxiv,medrxiv",
  },

  /** Recency window in years. §8.5: 1–20, default 3. */
  searchYears: {
    key: PREF_KEYS.searchYears,
    type: "integer",
    default: 3,
    min: 1,
    max: 20,
  },

  /** Result cap per run. §8.5: 10–200 (step 10 is the widget's), default 100. */
  maxResults: {
    key: PREF_KEYS.maxResults,
    type: "integer",
    default: 100,
    min: 10,
    max: 200,
  },

  /**
   * Import through `Zotero.Translate.Search` (Strategy B) instead of the
   * hand-mapped path.
   *
   * **Ships off, and §8.5 explains why at length:** Strategy B costs one network
   * lookup per record, which puts a 100-record import outside NFR-1's budget by
   * construction. An earlier draft shipped this `true`, promising a path no phase
   * built and a throughput target it could not meet at the same time.
   */
  useTranslators: {
    key: PREF_KEYS.useTranslators,
    type: "boolean",
    default: false,
  },

  /** Hide results already in the library. §8.5: default true. */
  hideExisting: {
    key: PREF_KEYS.hideExisting,
    type: "boolean",
    default: true,
  },

  /**
   * A **general** contact address, not an NCBI one.
   *
   * It fills Crossref's `mailto` parameter only; NCBI always receives the
   * maintainer address (decision D10). `docs/02` §2.2 calls the name
   * `ncbi.email` "actively misleading" for exactly this reason, and `P1-T03`'s
   * **Do NOT** forbids that spelling. Phase 2 is the phase that sends it.
   */
  contactEmail: {
    key: PREF_KEYS.contactEmail,
    type: "string",
    default: "",
  },

  // -------------------------------------------------------------------------
  // Runtime & concurrency — docs/07 §8.5, "Runtime & concurrency"
  // -------------------------------------------------------------------------

  /**
   * HTTP timeout in seconds. §8.5: 10–600 (step 10 is the widget's), default 60.
   *
   * `timeoutSeconds` × 1000 is the `timeout` passed to `Zotero.HTTP.request`;
   * `60` deliberately doubles Zotero's own 30 000 ms default because LLM calls
   * are long (§7.3).
   */
  timeoutSeconds: {
    key: PREF_KEYS.timeoutSeconds,
    type: "integer",
    default: 60,
    min: 10,
    max: 600,
  },

  /**
   * How far the pref migrations of §8.5.3 have got. `0` means none has run.
   *
   * Ships at `0` with **no migration entry**, and that is correct rather than
   * incomplete: §8.5.3 is explicit that renames applied *before* first release
   * need no migration entry, only document updates. A pref that has shipped may
   * only be renamed with an entry in `src/bootstrap/migrations.ts`.
   */
  prefsSchemaVersion: {
    key: PREF_KEYS.prefsSchemaVersion,
    type: "integer",
    default: 0,
    min: 0,
  },

  // -------------------------------------------------------------------------
  // Diagnostics — docs/07 §8.5, "Diagnostics"
  // -------------------------------------------------------------------------

  /**
   * Log verbosity. §8.5: `error` | `warn` | `info` | `debug`, default `warn`.
   * The union matches `src/core/logger.ts`'s `LogLevel` and
   * `DEFAULT_LOG_LEVEL`.
   *
   * **There is deliberately no `debug` boolean.** `docs/08` §7.3's "Verbose
   * debug logging" checkbox writes `debug` when checked and `warn` when
   * unchecked; §8.5's Diagnostics block records that an earlier draft shipped a
   * separate boolean and that it was removed, "because two switches over one
   * logger is exactly how a checkbox and a level drift apart". `P1-T03`'s
   * **Do NOT** repeats the ban.
   */
  logLevel: {
    key: PREF_KEYS.logLevel,
    type: "string",
    default: "warn",
    values: ["error", "warn", "info", "debug"],
  },

  /**
   * Log request and response bodies.
   *
   * A **content** switch, not a verbosity one, which is why the checkbox above
   * does not touch it and why raising `logLevel` never turns it on. It must
   * never write a credential whatever its value: `docs/09` §2.1's
   * `KEYISH_FIELD` / `KEY_PATTERNS` redaction runs at the logger regardless
   * (`src/core/errors.ts`, `src/core/logger.ts`).
   */
  logRequestBodies: {
    key: PREF_KEYS.logRequestBodies,
    type: "boolean",
    default: false,
  },

  // -------------------------------------------------------------------------
  // Non-secret key-presence flags — docs/07 §8.5, last block
  //
  // Per decision D5 and docs/09 §1.7, NO API KEY IS EVER A PREFERENCE. These
  // exist so the prefs pane can render a status row without a keychain
  // round-trip on every paint. They are written by the SecretStore and read by
  // the pane; nothing else may write them.
  // -------------------------------------------------------------------------

  /**
   * Whether an NCBI API key is in the keystore — **never the key**.
   *
   * Phase 1's with-key/no-key rate-limit switch reads this (`P1-T06`, `P1-T08`):
   * a keyed caller gets 10 req/s from E-utilities, an unkeyed one 3 req/s
   * (`docs/02` §3.1). §8.5 notes that a wrong or expired NCBI key does not
   * error — it silently drops the user back to 3 req/s — which is why the
   * validation-result row exists at all.
   */
  ncbiKeyPresent: {
    key: PREF_KEYS.ncbiKeyPresent,
    type: "boolean",
    default: false,
  },

  /**
   * Which secret backend is live, for the prefs pane's storage badge.
   *
   * §8.5's spellings, which are **not** `docs/09` §1.7's `SecretBackend` union
   * (`os-keychain` | `session-only` | `passphrase`): §8.5 is the authority for
   * the *preference's* allowed values and this row is what it declares. `""`
   * means the backend has not been probed yet.
   */
  secretBackend: {
    key: PREF_KEYS.secretBackend,
    type: "string",
    default: "",
    values: ["oskeystore", "session", "passphrase", ""],
  },
} as const satisfies Record<string, PrefDef<unknown>>;

/** The name plugin code passes to `getPref` / `setPref`. */
export type PrefName = keyof typeof PREFS;

/**
 * Widen a literal default back to the type it is a member of.
 *
 * **This repairs a defect in `docs/07` §8.5.1's sketch.** That section writes
 * `export type PrefValue<K extends PrefName> = (typeof PREFS)[K]["default"]`
 * beside a `PREFS` declared `as const` — so `PrefValue<"searchYears">` is the
 * literal type `3`, and `setPref("searchYears", 5)` is a compile error while
 * `getPref("searchYears")` is typed as being unable to return anything but `3`.
 * `as const` is load-bearing for `PrefName` and for the `key` strings, so the
 * widening belongs here rather than in the declaration.
 */
type Widen<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

/** The value type a preference holds — `boolean`, `number` or `string`. */
export type PrefValue<K extends PrefName> = Widen<(typeof PREFS)[K]["default"]>;

/** Every declared preference name, in declaration order. */
export const PREF_NAMES = Object.keys(PREFS) as readonly PrefName[];

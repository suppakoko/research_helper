/**
 * Preference key strings — the single source of truth (`docs/07` §2.2,
 * `P1-T03`).
 *
 * **Scope.** `P1-T03`. This file holds the *strings*; `./schema.ts` holds the
 * types, defaults and bounds that `docs/07` §8.5 fixes for each one. Splitting
 * them that way is what `docs/07` §2.2's tree asks for ("`keys.ts` — pref key
 * constants (single source of truth)") and it means a typo in a key is a
 * compile error in exactly one place rather than a silently-absent pref at run
 * time.
 *
 * **Only the twelve keys Phase 1 reads are here.** `docs/07` §8.5 declares 59
 * rows across seven blocks; `P1-T03`'s **Read first** names the subset Phase 1
 * needs and its **Do NOT** forbids declaring a preference the phase does not
 * read. Adding a row means adding it to `docs/07` §8.5 first, then here, then
 * to `addon/prefs.js`, then to the pane — §8.5's own ordering rule.
 *
 * ## The two call conventions
 *
 * `Zotero.Prefs.get(pref, global)` prefixes `pref` with
 * `ZOTERO_CONFIG.PREF_BRANCH` (`"extensions.zotero."`) when `global` is falsy,
 * and this plugin's branch nests under Zotero's own (`docs/01` §7.1). So the
 * same preference has two spellings and `docs/07` §8.5.1 tabulates which caller
 * uses which:
 *
 * | Caller | Form |
 * |---|---|
 * | Plugin code (`src/**`) | {@link PREF_BRANCH} + key, `global` omitted |
 * | `preference=` in the pane markup, and `prefs.js` | {@link PREF_BRANCH_ROOT} + key |
 *
 * `addon/prefs.js` carries the **bare** key in source: the scaffold prefixes it
 * at build time from `build.prefs.prefix` (`docs/13` §1.4), so the fully
 * qualified spelling above is a post-build statement, not what the file on disk
 * looks like.
 */

/**
 * Branch-relative prefix, as `Zotero.Prefs` takes it with `global` omitted.
 *
 * Note the trailing dot: `PREF_BRANCH + "searchYears"` must produce
 * `research-helper.searchYears`, which `Zotero.Prefs` then expands to
 * `extensions.zotero.research-helper.searchYears`.
 */
export const PREF_BRANCH = "research-helper.";

/**
 * The fully qualified branch, as `Services.prefs`, `about:config`, the pane's
 * `preference=` attribute and the post-build `prefs.js` spell it.
 *
 * It is `package.json`'s `config.prefsPrefix` plus a dot; that field is what
 * `zotero-plugin.config.ts` hands the scaffold, so the two cannot drift without
 * this constant being wrong.
 */
export const PREF_BRANCH_ROOT = "extensions.zotero.research-helper.";

/** `extensions.zotero.research-helper.<key>` — the markup / `prefs.js` form. */
export function qualifiedPrefKey(key: string): string {
  return PREF_BRANCH_ROOT + key;
}

/**
 * Branch-relative key per `docs/07` §8.5 row, keyed by the name plugin code
 * uses.
 *
 * The property name and the key string differ wherever §8.5 puts a row inside a
 * dotted family — `ncbiKeyPresent` → `"ncbi.keyPresent"` — which is the shape
 * §8.5.1's own example uses for `fullTextMode` → `"summary.fullTextMode"`. The
 * property is an identifier; the string is the preference.
 */
export const PREF_KEYS = {
  // Sources & search (docs/07 §8.5, "Sources & search").
  sources: "sources",
  searchYears: "searchYears",
  maxResults: "maxResults",
  useTranslators: "useTranslators",
  hideExisting: "hideExisting",
  contactEmail: "contactEmail",

  // Runtime & concurrency (docs/07 §8.5, "Runtime & concurrency").
  timeoutSeconds: "timeoutSeconds",
  prefsSchemaVersion: "prefsSchemaVersion",

  // Diagnostics (docs/07 §8.5, "Diagnostics").
  logLevel: "logLevel",
  logRequestBodies: "logRequestBodies",

  // Non-secret key-presence flags (docs/07 §8.5, last block). NEVER a key —
  // only whether one is present, and which backend holds it (decision D5).
  ncbiKeyPresent: "ncbi.keyPresent",
  secretBackend: "secretBackend",
} as const;

/** The name plugin code uses for a preference. */
export type PrefKeyName = keyof typeof PREF_KEYS;

/** A branch-relative preference key string. */
export type PrefKey = (typeof PREF_KEYS)[PrefKeyName];

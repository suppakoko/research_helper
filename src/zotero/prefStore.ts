/**
 * Non-secret preferences on `Zotero.Prefs` (`P0-T23`, the second half of
 * `V-16`).
 *
 * `docs/07` §8.5 owns every key, type and default; this spike module owns none
 * and restates none. It is the thin platform half of `docs/07` §8.5.1's
 * accessor: branch-relative keys, `global` omitted, so
 * `getPref("concurrency")` reads `extensions.zotero.research-helper.concurrency`
 * (`docs/01` §7.1). The typed `PREFS` schema and its coercion land in Phase 3
 * (`src/prefs/`), which will sit on top of this file; `plan/README.md` §4 lists
 * this path among the spike files a later card rewrites.
 *
 * **D5: nothing here may ever receive a credential** (`docs/00` §3,
 * `plan/README.md` §5 rule 5). {@link findBranchPrefsContaining} is the check
 * `P0-T23`'s spec uses to prove that no pref under the branch holds a secret.
 *
 * Observers are deliberately absent: `Zotero.Prefs.registerObserver` may only
 * be called from `src/zotero/registrations.ts` (`P0-T31`).
 */

/** Branch-relative prefix, as `Zotero.Prefs` takes it (`docs/07` §8.5.1). */
const BRANCH = "research-helper.";

/** The fully qualified branch, as `Services.prefs` and `prefs.js` spell it. */
export const PREF_BRANCH_ROOT = "extensions.zotero.research-helper.";

export type PrefScalar = boolean | number | string;

/** `extensions.zotero.research-helper.<key>`. */
export function qualifiedPrefName(key: string): string {
  return PREF_BRANCH_ROOT + key;
}

/** The value of `key`, from the user branch or the shipped default; `undefined` if neither. */
export function getPref(key: string): PrefScalar | undefined {
  return Zotero.Prefs.get(BRANCH + key);
}

/**
 * Write `key`. `Zotero.Prefs.set` creates a pref of the value's type when none
 * exists, and throws when an existing pref has a different type.
 */
export function setPref(key: string, value: PrefScalar): void {
  Zotero.Prefs.set(BRANCH + key, value);
}

/** Remove the user value, restoring the shipped default if there is one. */
export function clearPref(key: string): void {
  Zotero.Prefs.clear(BRANCH + key);
}

/** Whether `key` has a user value (as opposed to only a default, or nothing). */
export function prefHasUserValue(key: string): boolean {
  // `Zotero.Prefs.prefHasUserValue` exists at runtime but `zotero-types@4.1.3`
  // does not declare it; the Gecko call it wraps is declared.
  return Services.prefs.prefHasUserValue(qualifiedPrefName(key));
}

/** Every pref name under the branch, branch-relative, defaults included. */
export function listBranchPrefs(): string[] {
  return Services.prefs.getBranch(PREF_BRANCH_ROOT).getChildList("");
}

/** A pref's current value as a string, whatever its type. */
function readAsString(branch: nsIPrefBranch, name: string): string {
  switch (branch.getPrefType(name)) {
    case branch.PREF_STRING:
      return branch.getStringPref(name);
    case branch.PREF_INT:
      return String(branch.getIntPref(name));
    case branch.PREF_BOOL:
      return String(branch.getBoolPref(name));
    default:
      return "";
  }
}

/**
 * Branch-relative names of every pref under the branch whose value contains
 * any of `needles`. Returns names only, never values, so a hit cannot leak
 * the secret it found into a log.
 */
export function findBranchPrefsContaining(
  needles: readonly string[],
): string[] {
  const branch = Services.prefs.getBranch(PREF_BRANCH_ROOT);
  return branch.getChildList("").filter((name) => {
    const value = readAsString(branch, name);
    return needles.some((needle) => needle !== "" && value.includes(needle));
  });
}

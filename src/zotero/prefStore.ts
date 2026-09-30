/**
 * Non-secret preferences on `Zotero.Prefs` — the `PrefStore` port's platform
 * implementation (`P0-T23`, then `P1-T03` step 4).
 *
 * `docs/07` §8.5 owns every key, type and default; this module owns none and
 * restates none. It is the thin platform half of `docs/07` §8.5.1's accessor:
 * branch-relative keys, `global` omitted, so a read of `"concurrency"` reaches
 * `extensions.zotero.research-helper.concurrency` (`docs/01` §7.1). The typed
 * half — the `PREFS` schema, coercion, and the D5 write guard — is
 * `src/prefs/`, which sits on top of this file through
 * `src/core/config.ts`'s {@link PrefStore} port.
 *
 * **This file is the only place in `src/` that may name `Zotero.Prefs`**
 * (`P1-T03`'s **Do NOT**, `docs/07` §2.3, `eslint.config.js`'s
 * `research-helper/zotero-global` override). §8.5.1's own code block shows
 * `src/prefs/index.ts` calling `Zotero.Prefs` directly, which §2.3 of the same
 * document forbids; the card resolves it in §2.3's favour and this is the side
 * of the split that touches the platform.
 *
 * **D5: nothing here may ever receive a credential** (`docs/00` §3,
 * `plan/README.md` §5 rule 5). {@link findBranchPrefsContaining} is the check
 * `P0-T23`'s spec uses to prove that no pref under the branch holds a secret;
 * `src/prefs/index.ts`'s `guardWritable` is the check that stops one arriving.
 *
 * ## Why `P1-T03` extended this file instead of replacing it
 *
 * `plan/README.md` §4 lists this path among the sixteen a Phase 1 card `create`s
 * over a Phase 0 spike, and says "nothing in a spike version of those files is
 * load-bearing". That is not quite true here: `test/integration/zotero/
 * secrets.spec.ts` — `P0-T23`'s shipped measurement, and not in `P1-T03`'s
 * `Files` list — imports eight symbols from this module by name. Rewriting the
 * file wholesale would break a file this card may not touch, so the raw
 * string-keyed layer is kept as-is and {@link createZoteroPrefStore} is added on
 * top of it. The raw functions are exactly what the port needs anyway.
 *
 * `Zotero.Prefs.registerObserver` is still absent, deliberately: `FR-56` and
 * `eslint.config.js`'s `research-helper/scoped-registration` rule confine it to
 * `src/zotero/registrations.ts`, whose `prefObserverRegistration` pairs it with
 * the teardown that undoes it. {@link createZoteroPrefStore}'s `observe`
 * delegates there.
 */

import type { PrefObserverHandle, PrefScalar, PrefStore } from "../core/config";

import { prefObserverRegistration } from "./registrations";

/** Branch-relative prefix, as `Zotero.Prefs` takes it (`docs/07` §8.5.1). */
const BRANCH = "research-helper.";

/** The fully qualified branch, as `Services.prefs` and `prefs.js` spell it. */
export const PREF_BRANCH_ROOT = "extensions.zotero.research-helper.";

export type { PrefScalar };

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

// ---------------------------------------------------------------------------
// The PrefStore port — P1-T03 step 4
// ---------------------------------------------------------------------------

/**
 * The {@link PrefStore} `src/prefs/index.ts` reads and writes through.
 *
 * `src/bootstrap/` installs it once at startup with
 * `setPrefStore(createZoteroPrefStore())`. Everything above it — every source
 * adapter, pipeline and dialog that reads a setting — then sees preferences
 * through a port and needs no Zotero instance to be unit-tested (`docs/07` §2.3,
 * `docs/13` §2.1).
 *
 * `observe` returns `registrations.ts`'s `ScopedRegistration`, typed at the port
 * as the opaque {@link PrefObserverHandle}: `core/` may not name
 * `src/bootstrap/container.ts`'s types, and `FR-56` will not let an observer be
 * registered without the teardown that undoes it. The caller hands the handle to
 * a `Scope`.
 *
 * @returns a store over `Zotero.Prefs`, branch-relative keys
 */
export function createZoteroPrefStore(): PrefStore {
  return {
    get(key: string): PrefScalar | undefined {
      return getPref(key);
    },
    set(key: string, value: PrefScalar): void {
      setPref(key, value);
    },
    clear(key: string): void {
      clearPref(key);
    },
    observe(
      key: string,
      handler: (value: unknown) => void,
    ): PrefObserverHandle {
      return prefObserverRegistration(
        `pref observer: ${qualifiedPrefName(key)}`,
        {
          name: BRANCH + key,
          handler,
        },
      );
    },
  };
}

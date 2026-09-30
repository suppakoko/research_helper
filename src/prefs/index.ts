/**
 * The typed preference accessor — `docs/07` §8.5.1's `getPref` / `setPref` /
 * `clearPref` / `observePref` (`P1-T03` steps 2–3).
 *
 * **Plugin code never calls `Zotero.Prefs` directly** (§8.5.1). It goes through
 * this module "so that the key strings, the types and the defaults in this table
 * exist in exactly one place" — `./schema.ts`, transcribed from `docs/07` §8.5.
 *
 * ## One deliberate divergence from §8.5.1's code block, and why
 *
 * §8.5.1 prints this module calling `Zotero.Prefs.get` / `.set` / `.clear` /
 * `.registerObserver` directly, and calls it "the only module that touches
 * Zotero.Prefs for non-secret settings". **That cannot be built.** §2.3 of the
 * same document says "`zotero/` is the only directory permitted to reference
 * `Zotero.*`", `eslint.config.js`'s `research-helper/zotero-global` override
 * enforces it with `no-restricted-globals` over everything but `src/zotero/**`
 * and the three lifecycle entry files, and `P1-T03`'s own **Do NOT** resolves the
 * conflict in §2.3's favour: "do not call `Zotero.Prefs` from anywhere but
 * `src/zotero/prefStore.ts`".
 *
 * So this module is the *typed* half and `src/zotero/prefStore.ts` is the
 * *platform* half, joined by `src/core/config.ts`'s `PrefStore` port. The payoff
 * is not tidiness: it keeps this module, and therefore every source adapter and
 * pipeline that reads a setting, runnable under `vitest` in plain Node with no
 * Zotero instance (`docs/07` §2.3, `docs/13` §2.1).
 *
 * ## `getPref` never throws, and never clamps
 *
 * §8.5.1: "Never throws: a corrupt pref must not be able to stop a job from
 * starting." It returns the schema default when the stored value is absent, the
 * wrong type, outside the declared `min`/`max`, or outside a declared closed
 * value set — and when no store has been installed at all, which is what makes a
 * unit test of a source adapter need no fixture.
 *
 * **Out of range yields the default, not the nearest bound.** §8.5.1 lists "or
 * out of range" among the fallback conditions and `P1-T03` step 3 states the
 * consequence as a test: a stored `searchYears` of `99` yields `3`, not `20`.
 * Clamping would silently keep a corrupt value in play.
 *
 * ## The coercion foot-gun this module exists to absorb
 *
 * The pane's `preference=` binding applies `String(value)` on the way out
 * (`docs/08` §7.2), so `maxResults` and `timeoutSeconds` read back as **strings**
 * once a user has touched the control. §8.5.1: "Every integer and number pref
 * must go through `Number()`; string arithmetic on `maxResults` is a classic and
 * very confusing bug." {@link coerce} is where that happens, once.
 *
 * ## D5
 *
 * {@link guardWritable} refuses every write to a `secret: true` definition before
 * the value is coerced, before the store is touched, and without putting the
 * value in the error. No entry in `PREFS` is secret and none ever may be
 * (`docs/07` §8.5, `docs/09` §1.7, `plan/README.md` §5 rule 5); the guard is what
 * makes adding one a test failure instead of a silent credential leak.
 */

import type { PrefObserverHandle, PrefScalar, PrefStore } from "../core/config";
import { ConfigurationError } from "../core/errors";

import { PREFS, type PrefDef, type PrefName, type PrefValue } from "./schema";

// ---------------------------------------------------------------------------
// 1. The installed store
// ---------------------------------------------------------------------------

/**
 * The platform store, installed by the composition root.
 *
 * Module-scoped rather than passed to every call site because §8.5.1's four
 * functions are free functions taking only a `PrefName`, and because the
 * alternative — threading a `PrefStore` through every source adapter, pipeline
 * and dialog that reads one setting — is the plumbing a port is meant to remove.
 */
let installed: PrefStore | undefined;

/**
 * Install (or, with `undefined`, remove) the platform store.
 *
 * `src/bootstrap/` calls this once at startup with
 * `src/zotero/prefStore.ts`'s `createZoteroPrefStore()`. A test calls it with
 * `createMemoryPrefStore()` and clears it again afterwards.
 *
 * @param store - the store to read and write through, or `undefined` to detach
 */
export function setPrefStore(store: PrefStore | undefined): void {
  installed = store;
}

/** The installed store, or `undefined` if none has been installed. */
export function getPrefStore(): PrefStore | undefined {
  return installed;
}

/** The store, or a `ConfigurationError` naming the operation that needed it. */
function requireStore(operation: string, key: string): PrefStore {
  if (installed === undefined) {
    throw new ConfigurationError(
      `no PrefStore installed: cannot ${operation} "${key}". ` +
        `src/bootstrap/ must call setPrefStore() before any write.`,
      { key, operation },
    );
  }
  return installed;
}

// ---------------------------------------------------------------------------
// 2. Coercion — docs/07 §8.5.1
// ---------------------------------------------------------------------------

/**
 * Coerce a raw stored value to `def`'s declared type, or return `undefined`.
 *
 * `undefined` means "use the schema default" and covers all four of §8.5.1's
 * fallback conditions: absent, wrong type, out of `min`/`max` range, and outside
 * a declared closed value set.
 *
 * Numeric prefs go through `Number()`, which is the whole reason this function
 * exists. Booleans additionally accept the strings `"true"` and `"false"`: that
 * is the *same* `String(value)` foot-gun §8.5.1 names for numbers, applied to a
 * checkbox, and accepting them cannot produce a wrong value — the alternative is
 * silently reverting a user's checkbox to its default. String prefs accept only
 * strings, because a stored number under a string key *is* the wrong type and
 * `String(raw)` would launder it.
 *
 * @param def - the schema entry to coerce against
 * @param raw - whatever the store returned
 * @returns the coerced value, or `undefined` to fall back to `def.default`
 */
export function coerce(
  def: PrefDef<unknown>,
  raw: unknown,
): PrefScalar | undefined {
  const typed = coerceToType(def, raw);
  if (typed === undefined) {
    return undefined;
  }
  // A closed value set applies whatever the type. §8.5 gives one for `logLevel`
  // and `secretBackend`; a value outside it is as unusable as a wrong type.
  if (def.values !== undefined && !def.values.includes(typed)) {
    return undefined;
  }
  return typed;
}

/** {@link coerce} without the closed-value-set check. */
function coerceToType(
  def: PrefDef<unknown>,
  raw: unknown,
): PrefScalar | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  switch (def.type) {
    case "boolean":
      return coerceBoolean(raw);
    case "integer":
    case "number":
      return coerceNumeric(def, raw);
    case "string":
      return typeof raw === "string" ? raw : undefined;
  }
}

/** `true` / `false`, or the strings `String(true)` / `String(false)`. */
function coerceBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const lowered = raw.trim().toLowerCase();
  if (lowered === "true") {
    return true;
  }
  if (lowered === "false") {
    return false;
  }
  return undefined;
}

/**
 * `Number(raw)`, then §8.5.1's range check — and **no clamping**.
 *
 * A boolean is rejected rather than converted: `Number(true)` is `1`, which would
 * turn a type error into a plausible-looking setting.
 */
function coerceNumeric(
  def: PrefDef<unknown>,
  raw: unknown,
): number | undefined {
  if (typeof raw === "boolean") {
    return undefined;
  }
  if (typeof raw === "string" && raw.trim() === "") {
    // Number("") is 0, which for `searchYears` would be an out-of-range value
    // that looks deliberate. An empty pref is an absent pref.
    return undefined;
  }
  if (typeof raw !== "number" && typeof raw !== "string") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if (def.type === "integer" && !Number.isInteger(value)) {
    return undefined;
  }
  if (def.min !== undefined && value < def.min) {
    return undefined;
  }
  if (def.max !== undefined && value > def.max) {
    return undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 3. D5 — the write guard
// ---------------------------------------------------------------------------

/**
 * Refuse a write to a `secret: true` definition. Decision D5.
 *
 * Exported so `test/unit/prefs/schema.test.ts` can exercise the guard against a
 * synthetic secret definition — the card's criterion is "the D5 test fails if a
 * `secret: true` entry is added with a writer", and asserting only that no member
 * of `PREFS` is secret would leave the guard itself untested. It is also the
 * single place {@link setPref} and {@link writePref} agree on the rule.
 *
 * The thrown error names the **key** and never the value. `docs/09` §2.1 and
 * `NFR-16`: an error message reaches `Zotero.debug`, and debug output is
 * routinely pasted into public forums.
 *
 * @param def - the definition about to be written
 * @throws ConfigurationError if `def.secret` is `true`
 */
export function guardWritable(def: PrefDef<unknown>): void {
  if (def.secret === true) {
    throw new ConfigurationError(
      `D5 violation: ${def.key} may not be written to Zotero.Prefs. ` +
        `Secrets go through Zotero.OSKeyStore + Services.logins ` +
        `(src/zotero/keychain.ts); prefs hold only *.keyPresent flags.`,
      { key: def.key },
    );
  }
}

// ---------------------------------------------------------------------------
// 4. docs/07 §8.5.1's four accessors
// ---------------------------------------------------------------------------

/**
 * Read a preference, coerced to the schema's type.
 *
 * Falls back to the schema default when the value is absent, the wrong type, out
 * of range, outside a closed value set, or when no store is installed. **Never
 * throws**, including when the store itself does.
 *
 * @param name - a {@link PrefName}
 * @returns the coerced value, or `PREFS[name].default`
 */
export function getPref<K extends PrefName>(name: K): PrefValue<K> {
  const def: PrefDef<unknown> = PREFS[name];
  let raw: unknown;
  try {
    raw = installed?.get(def.key);
  } catch {
    // §8.5.1: "a corrupt pref must not be able to stop a job from starting."
    // A platform that throws on read is the same failure as an absent value.
    raw = undefined;
  }
  const coerced = coerce(def, raw);
  return (coerced ?? def.default) as PrefValue<K>;
}

/**
 * Write a preference, after the D5 guard and after coercion.
 *
 * Unlike {@link getPref} this **does** throw: a write of an out-of-range or
 * wrong-type value is a bug at the call site, and silently substituting the
 * default would hide it. §8.5.1's sketch names the same split
 * (`coerce` on read, `coerceOrThrow` on write).
 *
 * @param name - a {@link PrefName}
 * @param value - the value to store
 * @throws ConfigurationError on a secret definition, an unusable value, or a
 *   missing store
 */
export function setPref<K extends PrefName>(
  name: K,
  value: PrefValue<K>,
): void {
  writePref(PREFS[name], value);
}

/**
 * {@link setPref} against an explicit definition rather than a {@link PrefName}.
 *
 * The seam the D5 test writes through: a `secret: true` definition cannot be
 * added to `PREFS` without failing the schema assertions, so the guard is proven
 * against a definition constructed in the test instead.
 *
 * @param def - the definition to write
 * @param value - the value to store
 */
export function writePref(def: PrefDef<unknown>, value: unknown): void {
  // Order matters: the guard runs before the value is coerced, inspected or
  // handed to the platform, so a credential passed here never leaves this frame.
  guardWritable(def);

  const coerced = coerce(def, value);
  if (coerced === undefined) {
    throw new ConfigurationError(
      `rejected write to ${def.key}: a ${typeof value} is not a usable ` +
        `${def.type}${describeBounds(def)}.`,
      { key: def.key, type: def.type, received: typeof value },
    );
  }

  requireStore("write", def.key).set(def.key, coerced);
}

/** Bounds and closed value set, for a write-rejection message. Never a value. */
function describeBounds(def: PrefDef<unknown>): string {
  const parts: string[] = [];
  if (def.min !== undefined || def.max !== undefined) {
    parts.push(`in ${def.min ?? "-inf"}..${def.max ?? "inf"}`);
  }
  if (def.values !== undefined) {
    parts.push(`one of ${def.values.map((v) => JSON.stringify(v)).join(", ")}`);
  }
  return parts.length === 0 ? "" : ` (${parts.join("; ")})`;
}

/**
 * Remove the user value, restoring the `prefs.js` default.
 *
 * §8.5.3: user values are `user_pref(...)` lines in the profile and survive an
 * upgrade; this is what undoes one.
 *
 * @param name - a {@link PrefName}
 */
export function clearPref(name: PrefName): void {
  const def: PrefDef<unknown> = PREFS[name];
  requireStore("clear", def.key).clear(def.key);
}

/**
 * Watch a preference for changes.
 *
 * Used only where a change must repaint live UI (§8.5.1); everything else is read
 * on demand so a change takes effect on the next run without a restart.
 *
 * The returned {@link PrefObserverHandle} is **opaque** — see
 * `src/core/config.ts` for why it is not §8.5.1's `Symbol`: `FR-56` confines
 * `Zotero.Prefs.registerObserver` to `src/zotero/registrations.ts`, whose factory
 * pairs the registration with its teardown and returns a `ScopedRegistration`.
 * The composition root executes it against a `Scope`.
 *
 * @param name - a {@link PrefName}
 * @param handler - called with the new value
 * @returns the platform's handle, to be given to a `Scope`
 */
export function observePref(
  name: PrefName,
  handler: (value: unknown) => void,
): PrefObserverHandle {
  const def: PrefDef<unknown> = PREFS[name];
  return requireStore("observe", def.key).observe(def.key, handler);
}

export { PREFS, PREF_NAMES } from "./schema";
export type { PrefDef, PrefName, PrefValue } from "./schema";
export {
  PREF_BRANCH,
  PREF_BRANCH_ROOT,
  PREF_KEYS,
  qualifiedPrefKey,
} from "./keys";
export type { PrefKey, PrefKeyName } from "./keys";

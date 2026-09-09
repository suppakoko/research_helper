/**
 * The only module permitted to call Zotero's registration APIs (`P0-T31`).
 *
 * `P0-T07` made teardown *expressible* — `Registration<THandle>` cannot be
 * written without its `unregister`, and `Scope.use()` performs the platform
 * call and records the teardown in one statement. What it could not do is stop
 * someone calling the platform API directly and never pairing it with
 * anything. `docs/01` §12 gotcha 10: a forgotten `unregisterObserver` /
 * `unregisterMenu` leaves live closures referencing a dead plugin, and while
 * `docs/01` §2.4 notes that Zotero 10's `MenuManager` self-cleans on shutdown,
 * a plugin's own registrations remain the plugin's responsibility.
 *
 * `P0-T07`'s runtime tripwire is one-sided and stays that way:
 * `Zotero.PreferencePanes.pluginPanes` lets `hooks.reportSurvivors()` catch a
 * pane registered outside the scope, but `Zotero.MenuManager` and
 * `Zotero.Notifier` expose no equivalent enumeration in `zotero-types@4.1.3`,
 * so for those two there is no runtime audit at all. This file plus
 * `eslint.config.js`'s `research-helper/scoped-registration` rule are the
 * compile-time substitute: the rule makes naming one of the four APIs anywhere
 * else a lint error, and the factories here are the sanctioned way through.
 *
 * Each factory does one thing: it pairs a `register` call with the exact
 * `unregister` that undoes it, once, so the pairing cannot be half-written at
 * a call site. The result is a `ScopedRegistration`, which is what
 * `src/bootstrap/registerUI.ts`'s two lists hold.
 *
 * Nothing here performs a registration by itself. A `ScopedRegistration` is
 * inert until a `Scope` runs it, which is what keeps the lifetime decision
 * (`docs/01` §2.4: application-scoped in `startup`, window-scoped in
 * `onMainWindowLoad`) with the list the registration is put in rather than
 * with the factory that built it.
 */

import { registration, type ScopedRegistration } from "../bootstrap/container";

/**
 * Register a custom menu for the lifetime of a scope.
 *
 * `Zotero.MenuManager.registerMenu` returns `string | false` — `false` when
 * the options fail validation. That is thrown rather than swallowed: a menu
 * that silently did not appear is the failure `P0-T11` would otherwise spend a
 * disable/enable cycle chasing, and `Scope.use()` propagates it to the caller
 * with the registration's description already attached.
 *
 * @param description - stable, unique within its scope, and names the thing
 *   ("Tools menu item") rather than the call — it is what `liveHandles()`
 *   reports when teardown does not reach zero.
 * @param options - passed to `registerMenu` unchanged.
 */
export function menuRegistration<
  T extends _ZoteroTypes.MenuManager.ValidTarget,
>(
  description: string,
  options: _ZoteroTypes.MenuManager.MenuOptions<T>,
): ScopedRegistration {
  return registration<string>({
    description,
    register() {
      const menuID = Zotero.MenuManager.registerMenu(options);
      if (menuID === false) {
        throw new Error(
          `[research-helper] Zotero rejected the menu registration for ` +
            `"${description}" (menuID "${options.menuID}", target ` +
            `"${options.target}").`,
        );
      }
      return menuID;
    },
    unregister(menuID) {
      Zotero.MenuManager.unregisterMenu(menuID);
    },
  });
}

/**
 * The arguments `Zotero.Notifier.registerObserver` takes positionally, as one
 * object so a call site cannot transpose `id` and `priority`.
 */
export interface NotifierObserverOptions {
  /** The observer callback. Its signature is fixed by `zotero-types`. */
  readonly notify: _ZoteroTypes.Notifier.Notify;
  /** Event types the observer fires on. Omitted means all of them. */
  readonly types?: _ZoteroTypes.Notifier.Type[];
  /** Shown in Zotero's debug output; unrelated to the returned handle. */
  readonly id?: string;
  /** Lower numbers run earlier. */
  readonly priority?: number;
}

/**
 * Register a notifier observer for the lifetime of a scope.
 *
 * The handle is the observer ID string `registerObserver` returns, which is
 * not the same thing as the optional `id` passed in — that one is only a debug
 * label (`docs/01` §5.9). Threading the returned value through to
 * `unregisterObserver` is exactly what `Registration<THandle>` exists to make
 * unavoidable.
 */
export function notifierRegistration(
  description: string,
  options: NotifierObserverOptions,
): ScopedRegistration {
  return registration<string>({
    description,
    register() {
      return Zotero.Notifier.registerObserver(
        { notify: options.notify },
        options.types,
        options.id,
        options.priority,
      );
    },
    unregister(observerID) {
      Zotero.Notifier.unregisterObserver(observerID);
    },
  });
}

/**
 * The caller-supplied half of `Zotero.PreferencePanes.register`'s options.
 *
 * `defaultXUL` is omitted deliberately: `docs/01` §7.3 records that it is not
 * a caller option — `register()` sets it internally — and `P0-T07`'s `Do NOT`
 * block names passing it as a trap. There is also no `l10nID`; `label` is a
 * raw string.
 */
export type PreferencePaneOptions = Omit<
  _ZoteroTypes._PreferencePaneOption,
  "defaultXUL"
>;

/**
 * Register a preference pane for the lifetime of a scope.
 *
 * Zotero unregisters plugin panes automatically on shutdown, and this
 * registration is still paired with an explicit `unregister`. The pairing is
 * what makes the pane disappear on a plain disable — and, because the handle
 * is recorded in the scope, what makes it visible to `liveHandles()` if it
 * does not.
 *
 * `register` is async and resolves to the pane ID (`docs/01` §7.3); it is
 * **`register`**, not `registerPane`.
 */
export function preferencePaneRegistration(
  description: string,
  options: PreferencePaneOptions,
): ScopedRegistration {
  return registration<string>({
    description,
    register() {
      return Zotero.PreferencePanes.register(options);
    },
    unregister(paneID) {
      Zotero.PreferencePanes.unregister(paneID);
    },
  });
}

/** The arguments `Zotero.Prefs.registerObserver` takes positionally. */
export interface PrefObserverOptions {
  /**
   * The full preference name. When `global` is falsy Zotero prefixes it with
   * `extensions.zotero.` (`docs/01` §7.1), and this project's prefs live at
   * `extensions.zotero.research-helper.*`, so callers pass the branch-relative
   * name and leave `global` unset.
   */
  readonly name: string;
  /**
   * Typed `(value: unknown) => void` after `docs/07` §8.5.1's `observePref`.
   * `zotero-types` declares the parameter as the bare `Function`; narrowing it
   * here is the corpus's shape, not an invented one.
   */
  readonly handler: (value: unknown) => void;
  /** Pass `true` only for a pref outside the `extensions.zotero.` branch. */
  readonly global?: boolean;
}

/**
 * Register a preference observer for the lifetime of a scope.
 *
 * The handle is a `Symbol`, not a string, and `unregisterObserver` takes that
 * symbol — a second `registerObserver` for the same pref name produces a
 * different symbol and a second live observer, which is the duplicate-on-
 * re-enable failure `Scope`'s duplicate-description guard is also watching
 * for.
 */
export function prefObserverRegistration(
  description: string,
  options: PrefObserverOptions,
): ScopedRegistration {
  return registration<symbol>({
    description,
    register() {
      return Zotero.Prefs.registerObserver(
        options.name,
        options.handler,
        options.global,
      );
    },
    unregister(observer) {
      Zotero.Prefs.unregisterObserver(observer);
    },
  });
}

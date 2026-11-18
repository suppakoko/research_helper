/**
 * `P7-T15` (`NFR-10`): how long `hooks.onStartup` took, from its own
 * timestamps, so the plugin's startup cost can be read without a profiler.
 *
 * Caller: `src/hooks.ts`'s `onStartup`, which takes the four marks and stores
 * the result on `addon.data.startup`. Read by
 * `test/integration/startupCost.spec.ts` and by the owner's procedure in
 * `docs/spikes/phase-7-profiling.md`.
 *
 * Plain arithmetic in its own module, so a Node unit test can import it
 * without the Gecko globals `src/hooks.ts` pulls in.
 */

/** Milliseconds, from `Date.now()`, so each figure is whole and within 1 ms. */
export interface StartupTimings {
  /** Waiting for Zotero's three readiness promises: Zotero's time, not the plugin's. */
  readonly barrierMs: number;
  /** `registerUI`: services, menus, the preferences pane, the item pane section. */
  readonly registerUIMs: number;
  /** `onMainWindowLoad` for every main window already open. */
  readonly windowsMs: number;
  /** The plugin's own work after the barrier: `registerUIMs + windowsMs`. */
  readonly ownMs: number;
}

/**
 * @param begunAt - `onStartup` entered
 * @param readyAt - Zotero's readiness promises resolved
 * @param uiAt - `registerUI` returned
 * @param doneAt - every open main window was registered
 */
export function startupTimings(
  begunAt: number,
  readyAt: number,
  uiAt: number,
  doneAt: number,
): StartupTimings {
  return {
    barrierMs: readyAt - begunAt,
    registerUIMs: uiAt - readyAt,
    windowsMs: doneAt - uiAt,
    ownMs: doneAt - readyAt,
  };
}

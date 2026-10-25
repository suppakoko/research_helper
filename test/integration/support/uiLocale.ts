/* eslint-disable no-restricted-globals -- the integration suite's own helper: it sets the live platform's requested UI locale for a spec, which no src/zotero/ facade exposes (docs/13 §2.3). */
/**
 * Pin the UI locale for one spec, and put it back exactly as it was found.
 *
 * **Why (2026-10-26, `plan/00` §6 item 284(a)).** The test Zotero starts in
 * whatever locale the machine gives it, and on the machine this suite is run
 * on that is `ko-KR` (the runner logs `Zotero.locale ko-KR;
 * intl.locale.requested (default)`). Until the owner approved the 147 pending
 * Korean strings, the messages the search dialog and the preferences pane
 * assert on had no `ko-KR` entry and fell back to `en-US`, so specs asserting
 * English passed on a Korean machine by accident. With the Korean entries
 * live, those screens render Korean, and fifteen tests failed
 * (`plan/reports/followup-285b.md`, finding 1). A spec that asserts English
 * text now says so: it calls {@link pinUILocale} with `["en-US"]` before it
 * opens the window it reads, and {@link restoreUILocale} in its `after()`. The
 * suite then passes on a machine whose default is `ko-KR` and on one whose
 * default is `en-US`.
 *
 * **What a switch reaches.** `Services.locale.requestedLocales` writes
 * `intl.locale.requested` and renegotiates the app locales (on this machine
 * `["en-US"]` negotiates to `en-US` followed by four other English locales,
 * and back to `["ko-KR","en-US"]` on restore). A window opened after the
 * switch starts on the new chain. **Measured 2026-10-26:** a search window
 * that was already open on the `ko-KR` chain also re-translates — with the pin
 * moved to the end of `searchDialog-flow.spec.ts`'s `P1-T22` `before()`, after
 * the window had opened and connected, all of that block's English assertions
 * passed (195 of 195). The specs still pin before opening, so they do not
 * depend on that; an already-open *preferences* window was not measured.
 *
 * **Restoring.** The snapshot records whether the pref had a user value. If it
 * had none — the runner profile's default — the restore *clears* the pref
 * rather than writing the value it read, so the profile is left with no user
 * value, as it was. Then it waits until the negotiated app locales equal the
 * snapshot's, so the next spec starts on the chain this one found.
 *
 * `test/integration/l10n.spec.ts` uses the same three calls to switch between
 * `en-US` and `ko-KR` deliberately; it moved them here on 2026-10-26 so that
 * there is one copy.
 */

/** The preference `Services.locale.requestedLocales` reads and writes. */
export const LOCALE_PREF = "intl.locale.requested";

const STEP_TIMEOUT_MS = 20_000;

/** The UI-locale state a spec found, for {@link restoreUILocale}. */
export interface UILocaleSnapshot {
  /** Whether {@link LOCALE_PREF} had a user value. */
  readonly hadUserValue: boolean;
  /** {@link LOCALE_PREF}'s value, `""` when it had none. */
  readonly requested: string;
  /** `Services.locale.appLocalesAsBCP47` as found. */
  readonly appLocales: readonly string[];
}

/** One line to the runner's terminal, prefixed by the calling spec. */
export type UILocaleLog = (line: string) => void;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  condition: () => boolean,
  what: string,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > STEP_TIMEOUT_MS) {
      throw new Error(
        `timed out after ${STEP_TIMEOUT_MS} ms waiting for ${what}`,
      );
    }
    await delay(100);
  }
}

function idle(win: _ZoteroTypes.MainWindow): Promise<void> {
  return new Promise((resolve) => {
    win.requestIdleCallback(() => resolve());
  });
}

function sameLocales(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The UI-locale state as it is now. */
export function captureUILocale(): UILocaleSnapshot {
  const hadUserValue = Services.prefs.prefHasUserValue(LOCALE_PREF);
  return {
    hadUserValue,
    requested: Services.prefs.getCharPref(LOCALE_PREF, ""),
    appLocales: [...Services.locale.appLocalesAsBCP47],
  };
}

/** The snapshot as one log fragment. */
export function describeUILocale(snapshot: UILocaleSnapshot): string {
  return (
    `${LOCALE_PREF} ` +
    `${snapshot.hadUserValue ? JSON.stringify(snapshot.requested) : "(default)"}; ` +
    `app locales ${JSON.stringify(snapshot.appLocales)}`
  );
}

/**
 * Request `locales` as the UI locale and wait until the negotiated app locale
 * chain leads with the first of them.
 */
export async function requestUILocale(
  locales: readonly string[],
  log?: UILocaleLog,
): Promise<void> {
  Services.locale.requestedLocales = [...locales];
  await waitUntil(
    () => Services.locale.appLocalesAsBCP47[0] === locales[0],
    `app locales to lead with ${locales[0]}`,
  );
  // The windows' DOM localizations re-translate on intl:app-locales-changed;
  // let that settle before anything is read.
  await idle(Zotero.getMainWindow());
  log?.(
    `requested ${JSON.stringify(Services.locale.requestedLocales)} -> app ` +
      `${JSON.stringify(Services.locale.appLocalesAsBCP47)}`,
  );
}

/**
 * Capture the current UI locale, then request `locales`. Hand the result to
 * {@link restoreUILocale} in the same spec's `after()`.
 */
export async function pinUILocale(
  locales: readonly string[],
  log?: UILocaleLog,
): Promise<UILocaleSnapshot> {
  const snapshot = captureUILocale();
  log?.(`UI locale found: ${describeUILocale(snapshot)}`);
  await requestUILocale(locales, log);
  return snapshot;
}

/**
 * Put the UI locale back exactly as `snapshot` found it, and wait until the
 * app locales agree.
 */
export async function restoreUILocale(
  snapshot: UILocaleSnapshot,
  log?: UILocaleLog,
): Promise<void> {
  if (snapshot.hadUserValue) {
    Services.prefs.setCharPref(LOCALE_PREF, snapshot.requested);
  } else {
    Services.prefs.clearUserPref(LOCALE_PREF);
  }
  await waitUntil(
    () => sameLocales(Services.locale.appLocalesAsBCP47, snapshot.appLocales),
    "app locales to return to their original value",
  );
  await idle(Zotero.getMainWindow());
  log?.(
    `restored ${LOCALE_PREF} (user value ` +
      `${String(Services.prefs.prefHasUserValue(LOCALE_PREF))}); app ` +
      `${JSON.stringify(Services.locale.appLocalesAsBCP47)}`,
  );
}

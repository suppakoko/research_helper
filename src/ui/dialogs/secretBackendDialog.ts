/**
 * The degradation dialog (`docs/09` §1.7, `P3-T03`): what the user sees when
 * the startup keystore probe fails.
 *
 * It offers exactly two things, each with its cost stated:
 *
 * 1. **Session-only storage** (tier 2) — keys held in memory and written
 *    nowhere; they are entered again each time Zotero starts, and background
 *    work that needs a key stops until they are.
 * 2. **Running without stored keys** — searching and importing still work,
 *    and the features that need a key stay off.
 *
 * **There is no third option and there never is a silent one.** Tier 3, the
 * passphrase file, does not ship in v1 (gate `G-10`, decided 2026-10-08), and
 * tier 4, plaintext preferences, is refused by decision D5. `docs/09` §1.7
 * forbids falling from tier 1 to tier 2 without this dialog, so nothing
 * installs a store until {@link openSecretBackendDialog} resolves. Closing the
 * window resolves `"none"`: it stores nothing, which is not choosing a tier.
 *
 * ### Why this takes a window rather than fetching one
 *
 * For the reason `src/ui/dialogs/searchDialog.ts` gives: `src/ui/**` may not
 * reference the `Zotero` global or import `src/zotero/**`. So the window the
 * dialog is raised over is a parameter, and `src/bootstrap/registerUI.ts`
 * supplies it. No `Zotero.*` here and no DOM of its own: a URL, a window name,
 * a feature string and one argument object go to the platform, and a choice
 * comes back.
 */

import { config } from "../../../package.json";
import type { MainWindowMessageId } from "../../i18n/keys";

/** What the user can choose. `"none"` stores nothing. */
export const SECRET_BACKEND_CHOICES = ["session", "none"] as const;

/** One of {@link SECRET_BACKEND_CHOICES}. */
export type SecretBackendChoice = (typeof SECRET_BACKEND_CHOICES)[number];

/** Whether a value the window script reported is a choice this module knows. */
export function isSecretBackendChoice(
  value: unknown,
): value is SecretBackendChoice {
  return (SECRET_BACKEND_CHOICES as readonly unknown[]).includes(value);
}

/** The document the window loads, derived from `addonRef` as the search window's is. */
export const SECRET_BACKEND_DIALOG_URL = `chrome://${config.addonRef}/content/secretBackend.xhtml`;

/** The window name: a second open re-uses the window rather than stacking two. */
export const SECRET_BACKEND_DIALOG_NAME = "research-helper-secret-backend";

/**
 * Non-modal: the user can still look at their library while deciding. The
 * startup that opened it waits for the answer, so nothing of this plugin is
 * usable before then.
 */
export const SECRET_BACKEND_DIALOG_FEATURES =
  "chrome,titlebar,centerscreen,dialog=yes,resizable=no";

/** The dialog root, for `Zotero.UIProperties.registerRoot()` in the window script. */
export const SECRET_BACKEND_DIALOG_ROOT_ID = "rh-secret-backend-dialog";

/**
 * The dialog's six strings, in `research-helper-mainWindow.ftl` (`plan/04`
 * §0.2 item 1). Typed against {@link MainWindowMessageId}, so an id missing
 * from that bundle's list does not compile. `addon/content/secretBackend.js`
 * repeats the three it formats itself; the other three are `data-l10n-id`s in
 * `addon/content/secretBackend.xhtml`.
 */
export const SECRET_BACKEND_DIALOG_L10N = {
  title: "research-helper-secret-backend-title",
  explain: "research-helper-secret-backend-explain",
  session: "research-helper-secret-backend-session",
  none: "research-helper-secret-backend-none",
  accept: "research-helper-secret-backend-accept",
  decline: "research-helper-secret-backend-decline",
} as const satisfies Record<string, MainWindowMessageId>;

/**
 * What the window receives as `window.arguments[0]`. The window script calls
 * `onChoice` once: `"session"` on accept, `"none"` on cancel or close.
 */
export interface SecretBackendDialogArgs {
  onChoice(choice: string): void;
}

/** The one member of the host window this module calls. */
export interface SecretBackendDialogHost {
  openDialog(
    url?: string,
    name?: string,
    features?: string,
    ...extraArguments: unknown[]
  ): unknown;
}

/**
 * Open the dialog over `host` and resolve with the user's choice.
 *
 * Resolves on the **first** report only; anything the window reports that is
 * not a known choice resolves `"none"`, because the safe reading of an answer
 * this module cannot parse is "store nothing".
 *
 * @param host - the window to raise the dialog over
 * @returns the choice
 * @throws if `openDialog` returns no window. The caller treats that as "no
 *   store", and says so in the log, rather than choosing a tier for the user.
 */
export function openSecretBackendDialog(
  host: SecretBackendDialogHost,
): Promise<SecretBackendChoice> {
  return new Promise<SecretBackendChoice>((resolve, reject) => {
    let settled = false;
    const args: SecretBackendDialogArgs = {
      onChoice(choice: string): void {
        if (settled) return;
        settled = true;
        resolve(isSecretBackendChoice(choice) ? choice : "none");
      },
    };
    const win = host.openDialog(
      SECRET_BACKEND_DIALOG_URL,
      SECRET_BACKEND_DIALOG_NAME,
      SECRET_BACKEND_DIALOG_FEATURES,
      args,
    );
    if (win === null || win === undefined) {
      settled = true;
      reject(
        new Error(
          `[research-helper] openDialog("${SECRET_BACKEND_DIALOG_URL}") ` +
            "returned no window.",
        ),
      );
    }
  });
}

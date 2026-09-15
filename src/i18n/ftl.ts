/**
 * Fluent lookup helpers (`docs/07` §2.2, `P0-T24`).
 *
 * The spike version. `plan/README.md` §4 lists this path among the Phase 0
 * files a later card rewrites; the Phase 1 localization card writes the
 * shipped module (with typed message IDs in `src/i18n/keys.ts`) and replaces
 * this one. Nothing here is load-bearing beyond what `P0-T24` measured.
 *
 * ### What was measured, and what these helpers therefore assume
 *
 * - **The resource id is the bare, flat, plugin-prefixed filename.** Zotero 10
 *   registers every plugin's bundles in one `L10nFileSource` named
 *   `zotero-plugins`, at `zotero-plugins:{locale}/<filename>`, and drops any
 *   subdirectory under `locale/<locale>/` (`docs/01` §9.1, `P0-T32`).
 * - **Both `Localization` and `document.l10n` resolve it.** The template's
 *   `src/utils/locale.ts` uses `new Localization([\`${addonRef}-addon.ftl\`],
 *   true)` with `formatMessagesSync`; `P0-T32` confirmed that argument form and
 *   the async `document.l10n.formatMessages` in a window. The helpers below
 *   take either, through the one method both have.
 * - **Fallback has two layers, and only the second is per message.** Zotero's
 *   `registerLocales()` picks a *file* per Zotero locale (exact, same
 *   language, `en-US`, first available), so a Korean UI gets the whole `ko-KR`
 *   file. A message missing from that file is then found in `en-US` only
 *   because Gecko's `Localization` walks the app-locale chain, which ends in
 *   `en-US`. `test/integration/l10n.spec.ts` asserts both layers.
 *
 * ### What these helpers refuse to do
 *
 * They never return the message identifier as a stand-in for a string, which
 * is what the template's `getString` does. `FR-55` forbids showing an
 * identifier; a message that resolves in no locale comes back as `undefined`
 * so the caller has to decide, visibly, what to do about it.
 *
 * No `Zotero.*` here (`eslint.config.js`, `docs/13` §2.1), and no
 * `Zotero.getString()` for plugin strings ever (`docs/01` §12 gotcha 26).
 */

import { config } from "../../package.json";

/**
 * The prefix every Fluent identifier *and* every Fluent filename of this plugin
 * carries. Both are global namespaces and a collision silently shadows
 * (`docs/01` §9.3, §12 gotcha 16). Written by hand in the `.ftl` files: the
 * scaffold's `prefixFluentMessages` and `prefixLocaleFiles` are off
 * (`P0-T32`).
 */
export const FLUENT_PREFIX = `${config.addonRef}-`;

/** The four localization surfaces `docs/08` §10.1 owns, by their FTL stem. */
export type FluentSurface =
  "mainWindow" | "searchDialog" | "reportWindow" | "preferences";

/**
 * The Fluent resource id of one surface's bundle — the name to give
 * `insertFTLIfNeeded`, a `<link rel="localization" href>`, or `Localization`.
 */
export function fluentResourceId(surface: FluentSurface): string {
  return `${FLUENT_PREFIX}${surface}.ftl`;
}

/** Whether `id` carries this plugin's prefix (`docs/01` §9.3). */
export function isPluginMessageId(id: string): boolean {
  return id.startsWith(FLUENT_PREFIX) && id.length > FLUENT_PREFIX.length;
}

/**
 * The one method `Localization` and `DOMLocalization` (`document.l10n`) share
 * that these helpers need. Async on purpose: `docs/08` §10.1 quotes Mozilla
 * calling the sync forms strongly discouraged.
 */
export interface FluentFormatter {
  formatMessages(keys: L10nKey[]): Promise<(L10nMessage | null)[]>;
}

/** Arguments for a message with placeables, e.g. `{ count: 3 }`. */
export type FluentArgs = L10nArgs;

/**
 * Resolve one message, or `undefined` if it resolves in no locale of the
 * formatter's chain. Never the identifier.
 *
 * @throws if `id` lacks the plugin prefix — an unprefixed lookup is a bug that
 *   would otherwise succeed against someone else's message.
 */
export async function formatMessage(
  l10n: FluentFormatter,
  id: string,
  args?: FluentArgs,
): Promise<L10nMessage | undefined> {
  if (!isPluginMessageId(id)) {
    throw new Error(
      `[research-helper] Fluent id "${id}" lacks the "${FLUENT_PREFIX}" prefix ` +
        `(docs/01 §9.3).`,
    );
  }
  const [message] = await l10n.formatMessages([
    args === undefined ? { id } : { id, args },
  ]);
  return message ?? undefined;
}

/**
 * Resolve one attribute of a message — `label` for a `MenuManager` item, whose
 * FTL entry must set `.label` (`docs/08` §10.1) — or `undefined` if the message
 * or the attribute is missing. An empty string counts as missing: an empty
 * label is exactly the silent failure `P0-T10` chased.
 */
export async function formatAttribute(
  l10n: FluentFormatter,
  id: string,
  attribute: string,
  args?: FluentArgs,
): Promise<string | undefined> {
  const message = await formatMessage(l10n, id, args);
  const value = message?.attributes?.find(
    (attr) => attr.name === attribute,
  )?.value;
  return value === undefined || value === "" ? undefined : value;
}

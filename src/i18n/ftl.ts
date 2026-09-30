/**
 * Fluent lookup for this plugin's own bundles — the shipped module (`P1-T18`).
 *
 * `plan/README.md` §4 lists this path among the Phase 0 files a later card
 * rewrites; this is that rewrite. `P0-T24`'s spike version measured the
 * platform and shaped these helpers; what Phase 1 adds is the typed
 * vocabulary in {@link ../i18n/keys}, so a lookup of a message that no bundle
 * declares, or a lookup missing an argument the message needs, is a compile
 * error rather than a blank label in the user's face.
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
 *   `en-US`. A `Localization` built with an explicit locale list that omits
 *   `en-US` gets no fallback at all. `test/integration/l10n.spec.ts` asserts
 *   both layers, and the `ko-KR` bundles depend on the second one: most of
 *   their messages are still awaiting the `P1-T18` human gate.
 * - **Inserting a bundle into a window Zotero owns is undoable.** That is
 *   `src/zotero/registrations.ts`'s `fluentResourceRegistration()`, the only
 *   place allowed to call `insertFTLIfNeeded`, and it probes a message and
 *   removes the link again if the probe fails (`P0-T32`, `FR-56`). Nothing
 *   here touches a window.
 *
 * ### What these helpers refuse to do
 *
 * They never return the message identifier as a stand-in for a string, which
 * is what the template's `getString` does. `FR-55` forbids showing an
 * identifier; a message that resolves in no locale comes back as `undefined`
 * so the caller has to decide, visibly, what to do about it.
 *
 * They are async. `docs/08` §10.1 quotes Mozilla calling `formatValueSync()`
 * "strongly discouraged", and `Zotero.getString()` is not an option at all for
 * a plugin string: it throws on an unknown key when `Zotero.locale` is `en-US`
 * (`docs/08` §8.2.1) and a plugin `.ftl` lives in `L10nRegistry`, not in
 * `getString`'s synchronous bundle. Everything downstream of these helpers —
 * `P1-T15`'s progress sink, the search window's document — receives an
 * **already localized string**, never an id.
 *
 * No `Zotero.*` here (`eslint.config.js`, `docs/13` §2.1).
 */

import { config } from "../../package.json";
import {
  ERROR_MESSAGE_PREFIX,
  MESSAGE_PREFIX,
  type FluentArgsParam,
  type FluentMessageId,
  type FluentSurface,
} from "./keys";

export type { FluentMessageId, FluentSurface };

/**
 * The prefix every Fluent identifier *and* every Fluent filename of this plugin
 * carries. Both are global namespaces and a collision silently shadows
 * (`docs/01` §9.3, §12 gotcha 16). Written by hand in the `.ftl` files: the
 * scaffold's `prefixFluentMessages` and `prefixLocaleFiles` are off
 * (`P0-T32`).
 *
 * Derived from `package.json` rather than written out, and cross-checked
 * against `keys.ts`'s literal by {@link MESSAGE_PREFIX_MATCHES_ADDON_REF} so
 * that a rename of `addonRef` cannot silently desynchronise the two.
 */
export const FLUENT_PREFIX = `${config.addonRef}-`;

/**
 * Whether the prefix derived from `package.json` is the one the `.ftl` files
 * and `keys.ts` are written with. Asserted by
 * `test/integration/l10n.spec.ts`; exported as a value rather than checked at
 * module load so that a mismatch fails a test instead of the plugin's startup.
 */
export const MESSAGE_PREFIX_MATCHES_ADDON_REF =
  FLUENT_PREFIX === MESSAGE_PREFIX;

/**
 * The prefixes a message id of this plugin may carry.
 *
 * There should be one. `docs/01` §9.3 says so with "No exceptions", and the
 * second entry is `ResearchHelperError.messageKey`'s (`docs/07` §10.1), whose
 * sixteen Phase 1 values are fixed in `src/core/errors.ts` and asserted by
 * `P1-T02`'s unit test. `P1-T18` reports that conflict rather than resolving it
 * in code: renaming those keys touches three files outside its `Files` list.
 *
 * Until it is resolved this array is the one place that tolerates it, so that
 * `grep ERROR_MESSAGE_PREFIX` finds every line that depends on the divergence.
 * Nothing new may use the second prefix.
 */
export const MESSAGE_ID_PREFIXES = [
  MESSAGE_PREFIX,
  ERROR_MESSAGE_PREFIX,
] as const;

/**
 * The Fluent resource id of one surface's bundle — the name to give
 * `insertFTLIfNeeded`, a `<link rel="localization" href>`, or `Localization`.
 */
export function fluentResourceId(surface: FluentSurface): string {
  return `${FLUENT_PREFIX}${surface}.ftl`;
}

/**
 * Whether `id` carries one of this plugin's prefixes (`docs/01` §9.3).
 *
 * A bare `true` here is not a claim that the message exists — only that a
 * lookup of it cannot resolve against another plugin's or Zotero's own
 * message, which is the failure §9.3 calls "far worse" than an error because
 * it is silent.
 */
export function isPluginMessageId(id: string): boolean {
  return MESSAGE_ID_PREFIXES.some(
    (prefix) => id.startsWith(prefix) && id.length > prefix.length,
  );
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
 * `id` is constrained to {@link FluentMessageId}, and the argument object to
 * the one that message declares in `keys.ts` — so a message with a
 * `{ $count }` selector cannot be looked up without a count, and a message
 * without placeables cannot be handed one. Fluent does not fail on a missing
 * argument: it renders the placeable source text at the user, which is the
 * class of bug this signature exists to make impossible.
 *
 * @throws if `id` lacks a plugin prefix. Unreachable through the type system
 *   and kept as a runtime guard for the untyped edges (a `data-l10n-id` read
 *   back out of the DOM, an id crossing the sandbox boundary): an unprefixed
 *   lookup is a bug that would otherwise *succeed*, against someone else's
 *   message.
 */
export async function formatMessage<Id extends FluentMessageId>(
  l10n: FluentFormatter,
  id: Id,
  ...args: FluentArgsParam<Id>
): Promise<L10nMessage | undefined> {
  if (!isPluginMessageId(id)) {
    throw new Error(
      `[research-helper] Fluent id "${id}" carries none of the prefixes ` +
        `${MESSAGE_ID_PREFIXES.map((p) => `"${p}"`).join(" / ")} ` +
        `(docs/01 §9.3).`,
    );
  }
  // `FluentArgsParam` yields an anonymous object type per message; `L10nArgs`
  // is `Record<string, string | number | null>`. The cast is over the generic
  // parameter, which TypeScript cannot relate to an index signature, and not
  // over any value shape: every member of every entry in
  // `FluentMessageArgsMap` is already a `string` or a `number`.
  const [supplied] = args;
  const [message] = await l10n.formatMessages([
    supplied === undefined ? { id } : { id, args: supplied as FluentArgs },
  ]);
  return message ?? undefined;
}

/**
 * Resolve a message's value — the text of a message with no attributes — or
 * `undefined` if it resolves in no locale, or has no value of its own. An empty
 * string counts as missing, for the same reason {@link formatAttribute} says so.
 */
export async function formatValue<Id extends FluentMessageId>(
  l10n: FluentFormatter,
  id: Id,
  ...args: FluentArgsParam<Id>
): Promise<string | undefined> {
  const message = await formatMessage(l10n, id, ...args);
  const value = message?.value ?? undefined;
  return value === null || value === undefined || value === ""
    ? undefined
    : value;
}

/**
 * Resolve one attribute of a message — `label` for a `MenuManager` item, whose
 * FTL entry must set `.label` (`docs/08` §10.1) — or `undefined` if the message
 * or the attribute is missing. An empty string counts as missing: an empty
 * label is exactly the silent failure `P0-T10` chased.
 */
export async function formatAttribute<Id extends FluentMessageId>(
  l10n: FluentFormatter,
  id: Id,
  attribute: string,
  ...args: FluentArgsParam<Id>
): Promise<string | undefined> {
  const message = await formatMessage(l10n, id, ...args);
  const value = message?.attributes?.find(
    (attr) => attr.name === attribute,
  )?.value;
  return value === undefined || value === "" ? undefined : value;
}

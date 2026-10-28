import zotero from "@zotero-plugin/eslint-config";

/**
 * ESLint flat config for research_helper.
 *
 * Two project rules are encoded here, and they are the reason this file is not
 * just a re-export of the shared config:
 *
 * 1. The one-way dependency rule of docs/07 §2.3:
 *
 *        ui/ -> pipeline/ -> { sources/, llm/, tts/, zotero/ } -> core/ -> model/
 *
 *    §2.3 calls it "mechanically enforceable with an ESLint
 *    `no-restricted-imports` config"; P0-T04 makes it mechanical.
 *
 * 2. docs/13 §2.1: the `Zotero` global is forbidden outside `src/zotero/`.
 *    docs/07 §2.3 makes `src/zotero/` "the only directory permitted to
 *    reference `Zotero.*`", and the compatibility-isolation argument for risk
 *    R-1 (docs/11 §3) rests on that being true, not merely documented.
 *
 * 3. FR-56 (P0-T31): the five platform registration APIs may only be called
 *    from `src/zotero/registrations.ts`, which pairs each one with the
 *    teardown that undoes it. Rule 2 is not enough on its own — it permits
 *    every file in `src/zotero/**`, and P0-T10 is about to add three more.
 *
 * The first two are expressed against the *import specifier* / *global name*,
 * so they fire on relative imports at any depth (`../ui/x`, `../../ui/x`).
 */

/** Gitignore-style patterns matching a `src/` layer at any relative depth. */
function layer(name) {
  return [`**/${name}`, `**/${name}/**`];
}

/**
 * A `no-restricted-imports` rule entry forbidding every named layer.
 *
 * @param {string[]} layers - layer directory names that must not be imported
 * @param {string} message - the explanation reported to the developer
 */
function forbidLayers(layers, message) {
  return {
    "no-restricted-imports": [
      "error",
      { patterns: [{ group: layers.flatMap(layer), message }] },
    ],
  };
}

const RULE = "docs/07 §2.3 dependency rule:";

/**
 * The platform registration APIs of `docs/01` §2.4, each with the
 * `src/zotero/registrations.ts` factory that replaces it.
 *
 * `Zotero.ItemPaneManager.registerSection` joined on 2026-10-29 (`P3-T28`),
 * with the first section that registers one (`docs/08` §3): it leaks the same
 * way the other four do, and `itemPaneSectionRegistration` pairs it with
 * `unregisterSection`. Until then it was deliberately absent because no card
 * registered a section (`P0-T31`).
 */
const REGISTRATION_APIS = [
  { manager: "MenuManager", method: "registerMenu", via: "menuRegistration" },
  {
    manager: "Notifier",
    method: "registerObserver",
    via: "notifierRegistration",
  },
  {
    manager: "PreferencePanes",
    method: "register",
    via: "preferencePaneRegistration",
  },
  {
    manager: "Prefs",
    method: "registerObserver",
    via: "prefObserverRegistration",
  },
  {
    manager: "ItemPaneManager",
    method: "registerSection",
    via: "itemPaneSectionRegistration",
  },
];

/**
 * A `no-restricted-syntax` entry banning one unscoped registration call.
 *
 * `no-restricted-properties` cannot express this. It compares
 * `node.object.name`, which is `undefined` for the outer member expression of
 * `Zotero.MenuManager.registerMenu` — its `object` is itself a
 * `MemberExpression` — so `{ object: "MenuManager", property: "registerMenu" }`
 * never fires (measured, P0-T31). Matching on `property` alone does fire, but
 * `register` is far too generic to ban by name.
 *
 * The selector matches the member expression in *any* position, not just as a
 * callee, so `const f = Zotero.MenuManager.registerMenu` is caught too. The
 * one position excluded is an assignment target: `Zotero.X.y = fn` *defines* a
 * property rather than calling one, which is what a test double does
 * (`test/setup/zotero-global.ts`) and is not a registration.
 */
function forbidUnscopedRegistration({ manager, method, via }) {
  return {
    selector:
      `MemberExpression[object.object.name='Zotero']` +
      `[object.property.name='${manager}'][property.name='${method}']` +
      `:not(AssignmentExpression > MemberExpression.left)`,
    message:
      `FR-56: use ${via}() from src/zotero/registrations.ts; a bare ` +
      `Zotero.${manager}.${method} is a registration nothing will undo.`,
  };
}

/**
 * A `no-restricted-syntax` entry banning `debug: true` in an object literal
 * passed to `Zotero.HTTP.request` — `docs/09` §2.1: "The plugin must never pass
 * `debug: true` … A lint rule forbids it." Zotero's `debug` option logs
 * response text, and an LLM response carries the user's paper content (P3-T01).
 *
 * It is appended to the scoped-registration block's array rather than given a
 * block of its own: under flat-config precedence a later block that sets
 * `no-restricted-syntax` for the same files *replaces* the earlier array, which
 * would silently drop the FR-56 selectors.
 *
 * The key may be an identifier or a string literal. `[value.value=true]` is
 * esquery's string comparison, so it also catches `debug: "true"`. What it
 * cannot see is an options object built elsewhere and passed by name; the one
 * real call site, `createZoteroHttpTransport` in `src/zotero/zoteroApi.ts`,
 * forwards `HttpTransportOptions` from `src/core/http/client.ts`, a type that
 * declares no `debug` member, so the compiler closes that path instead.
 */
const FORBID_HTTP_DEBUG = {
  selector:
    `CallExpression[callee.object.object.name='Zotero']` +
    `[callee.object.property.name='HTTP'][callee.property.name='request']` +
    ` > ObjectExpression > Property` +
    `:matches([key.name='debug'], [key.value='debug'])[value.value=true]`,
  message:
    "docs/09 §2.1: never pass `debug: true` to Zotero.HTTP.request; it logs " +
    "response text, and LLM responses carry the user's paper content.",
};

export default zotero({
  overrides: [
    {
      // `model/` is pure data: it imports nothing but itself. Declaring the
      // SourceId / ProviderId unions and Usage here rather than in an adapter
      // is what keeps this acyclic (docs/07 §2.3, first bullet).
      name: "research-helper/layering/model",
      files: ["src/model/**/*.ts"],
      rules: forbidLayers(
        [
          "bootstrap",
          "core",
          "sources",
          "llm",
          "tts",
          "pipeline",
          "zotero",
          "ui",
          "prefs",
          "prompts",
          "i18n",
          "utils",
        ],
        `${RULE} model/ may import nothing but model/.`,
      ),
    },
    {
      // `core/` is platform-agnostic infrastructure. Where it needs a platform
      // capability it declares a port (PrefStore, Clock, HttpClient) and the
      // container supplies the implementation.
      name: "research-helper/layering/core",
      files: ["src/core/**/*.ts"],
      rules: forbidLayers(
        [
          "bootstrap",
          "sources",
          "llm",
          "tts",
          "pipeline",
          "zotero",
          "ui",
          "prefs",
          "prompts",
          "i18n",
          "utils",
        ],
        `${RULE} core/ may import only model/.`,
      ),
    },
    {
      // The adapter tier. It sits below pipeline/ and ui/ in the arrow, so it
      // may not reach back up into them.
      name: "research-helper/layering/adapters",
      files: [
        "src/sources/**/*.ts",
        "src/llm/**/*.ts",
        "src/tts/**/*.ts",
        "src/zotero/**/*.ts",
      ],
      rules: forbidLayers(
        ["pipeline", "ui"],
        `${RULE} sources/, llm/, tts/ and zotero/ may not import pipeline/ or ui/.`,
      ),
    },
    {
      // `pipeline/` composes the adapters and zotero/. It never touches DOM,
      // and never depends on the UI that drives it.
      name: "research-helper/layering/pipeline",
      files: ["src/pipeline/**/*.ts"],
      rules: forbidLayers(["ui"], `${RULE} pipeline/ may not import ui/.`),
    },
    {
      // `ui/` never calls an adapter directly — only pipelines and the job
      // queue.
      name: "research-helper/layering/ui",
      files: ["src/ui/**/*.ts"],
      rules: forbidLayers(
        ["sources", "llm", "tts", "zotero"],
        `${RULE} ui/ may not import sources/, llm/, tts/ or zotero/ directly; go through pipeline/.`,
      ),
    },
    {
      // docs/13 §2.1. `src/zotero/**` and `addon/**` are the exemptions the
      // rule is written around. The three lifecycle entry files are exempt
      // too: docs/07 §2.2 places index.ts / addon.ts / hooks.ts outside the
      // layer directories, and they are by construction the sandbox boundary
      // that installs the plugin object on `Zotero` and awaits Zotero's
      // startup promises. Nothing else in the tree may name the global.
      name: "research-helper/zotero-global",
      files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
      ignores: [
        "src/zotero/**",
        "addon/**",
        "src/index.ts",
        "src/addon.ts",
        "src/hooks.ts",
        "eslint.config.js",
        "zotero-plugin.config.ts",
      ],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            name: "Zotero",
            message:
              "docs/07 §2.3 / docs/13 §2.1: src/zotero/ is the only directory permitted to reference Zotero.*. Go through the src/zotero/ facade, or take a port (PrefStore, Clock, HttpClient) from the container.",
          },
        ],
      },
    },
    {
      // FR-56 / P0-T31. A registration handle that is never paired with its
      // teardown leaves a live closure referencing a dead plugin
      // (docs/01 §12 gotcha 10), and only one of the four APIs —
      // PreferencePanes, via `pluginPanes` — can be audited at runtime, so
      // MenuManager, Notifier and Prefs have no check at all short of
      // P0-T11's manual disable/enable cycling. This rule is the check.
      //
      // The exemption is two named files, not a directory. `src/zotero/**` is
      // already the exemption for the Zotero global and P0-T10 adds three more
      // files to it; exempting it wholesale would leave the rule guarding
      // nothing exactly where it matters most.
      //
      // `scripts/probe-types.ts` is the second: P0-T06's type-only probe is
      // never executed and never bundled, its entire job is to make the
      // compiler resolve these declarations, and it already carries a
      // file-level `eslint-disable no-restricted-globals` for the same reason.
      name: "research-helper/scoped-registration",
      files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
      ignores: ["src/zotero/registrations.ts", "scripts/probe-types.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          ...REGISTRATION_APIS.map(forbidUnscopedRegistration),
          FORBID_HTTP_DEBUG,
        ],
      },
    },
  ],
});

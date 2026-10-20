import { describe, expect, it } from "vitest";

import {
  BudgetExceededError,
  ContentFilterError,
  ContextLengthExceededError,
  LLMError,
  PolicyViolationError,
  StructuredOutputError,
  TTSError,
} from "../../../src/core/errors";
import * as keys from "../../../src/i18n/keys";

/**
 * `P1-T40`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network, no
 * bundle read — so the whole file runs in milliseconds.
 *
 * ## What this file is for
 *
 * `src/i18n/keys.ts`'s lists stand in fixed set relations to one another: the
 * two surface lists partition the declared vocabulary, the three `ko-KR` lists
 * partition it again, `ERROR_MESSAGE_IDS` is exactly its `rh-error-` part,
 * `DEFERRED_ERROR_MESSAGE_IDS` is deliberately outside it, and
 * `ARGUMENT_MESSAGE_IDS` is inside it. **The compiler cannot see most of
 * those.** `satisfies readonly FluentMessageId[]` constrains what may be *in* a
 * list; nothing constrains what must be. `P1-T33`'s mutation M3 measured it —
 * an id dropped from `KO_PENDING_REVIEW` alone leaves `npm run typecheck` at
 * exit 0 — and `P1-T45`'s agent reproduced it with three ids at once.
 *
 * Until this file existed the only check was
 * `test/integration/l10n.spec.ts:765`, which compares the Korean lists against
 * the **live `ko-KR` bundles** and therefore costs a full Zotero launch. That
 * spec keeps the bundle half, which is its business and cannot be done here;
 * this file takes the half that is pure set arithmetic over the source lists
 * and makes it sub-second.
 *
 * ## Why the lists are imported as values
 *
 * A partition assertion over an empty set is **vacuously true**, and that is
 * the measured way a check of this exact file fails while appearing to
 * succeed: an earlier attempt parsed `keys.ts` as text, anchored on the first
 * occurrence of a list's name — a documentation comment, not the declaration —
 * and printed "PARTITION: OK" having parsed zero identifiers. Importing the
 * lists as values makes that impossible by construction, and {@link read} adds
 * a belt to the braces by failing on any list that is empty. No claim here
 * needs the file's text, so nothing here parses it.
 *
 * ## What is deliberately not asserted
 *
 * - **Anything a bundle has to answer.** Whether an id is present in, or
 *   missing from, a real `.ftl` is `l10n.spec.ts`'s, and deleting one of its
 *   expensive assertions is not this card's call.
 * - **Compile-time facts.** `A ⊆ FluentMessageId` for each list (the
 *   `satisfies` clauses), `FluentMessageId ⊆ DeclaredMessageId`
 *   (`UndeclaredBundleMessageId`), and the two directions between
 *   `FluentMessageArgsMap`'s keys and `ARGUMENT_MESSAGE_IDS`
 *   (`UndeclaredArgumentMessageId`, `UnlistedArgumentMessageId`) are all
 *   `TS2344`s already. An `interface` is not enumerable at runtime anyway, so
 *   the map itself cannot be walked from here.
 * - **Counts.** `plan/README.md` §7 and `G-41` both record numbers going stale
 *   in several places at once. Every assertion below compares sets, which do
 *   not go stale; the only numeric assertion is "not zero".
 */

/* ------------------------------------------------------------------ helpers */

/**
 * Every array `keys.ts` exports, by its exported name.
 *
 * The first test below asserts this registry is **complete** against the
 * module's own exports, so a list added to `keys.ts` cannot quietly escape the
 * empty-set guard — it fails here until someone states its relation.
 */
const LISTS = {
  SHIPPED_SURFACES: keys.SHIPPED_SURFACES,
  MAIN_WINDOW_MESSAGE_IDS: keys.MAIN_WINDOW_MESSAGE_IDS,
  SEARCH_DIALOG_MESSAGE_IDS: keys.SEARCH_DIALOG_MESSAGE_IDS,
  ERROR_MESSAGE_IDS: keys.ERROR_MESSAGE_IDS,
  DEFERRED_ERROR_MESSAGE_IDS: keys.DEFERRED_ERROR_MESSAGE_IDS,
  KO_PENDING_REVIEW: keys.KO_PENDING_REVIEW,
  KO_DELIBERATELY_ABSENT: keys.KO_DELIBERATELY_ABSENT,
  KO_PRESENT: keys.KO_PRESENT,
  ARGUMENT_MESSAGE_IDS: keys.ARGUMENT_MESSAGE_IDS,
} satisfies Record<string, readonly string[]>;

type ListName = keyof typeof LISTS;

/**
 * The exported `L10N_*` constants that are single message identifiers, and
 * must therefore be members of the surface list that owns them.
 *
 * `L10N_EXPORT_TAKES_NO_PATH` is **not** one of them and is listed separately
 * below: it is a sentence of documentation, not an id. It is also the reason
 * this registry is written out by hand rather than discovered by filtering the
 * module's `L10N_*` string exports on the message prefix — that sentence
 * begins "research-helper-search-export-written takes no…", so it starts with
 * `MESSAGE_PREFIX` and a prefix filter would mistake it for an identifier.
 */
const ID_CONSTANTS = {
  L10N_MENU_ROOT: keys.L10N_MENU_ROOT,
  L10N_MENU_SEARCH_IMPORT: keys.L10N_MENU_SEARCH_IMPORT,
  L10N_MENU_COLLECTION_SEARCH_IMPORT: keys.L10N_MENU_COLLECTION_SEARCH_IMPORT,
  // `P2-T17`: FR-12's "Re-run This Search…".
  L10N_MENU_COLLECTION_RERUN: keys.L10N_MENU_COLLECTION_RERUN,
  L10N_MENU_SPIKE_CREATE_ITEM: keys.L10N_MENU_SPIKE_CREATE_ITEM,
  L10N_PROGRESS_HEADLINE: keys.L10N_PROGRESS_HEADLINE,
} satisfies Record<string, string>;

/** The exported `L10N_*` string constants that are not message identifiers. */
const NON_ID_L10N_CONSTANTS = ["L10N_EXPORT_TAKES_NO_PATH"];

/**
 * A list from {@link LISTS}, having first failed the test if it is empty.
 *
 * This is the "impossible by construction" half of `P1-T40`'s `Do` step 2: no
 * assertion below can read a list without going through here, so no assertion
 * below can be vacuously true for want of members.
 */
function read(name: ListName): readonly string[] {
  const list: readonly string[] = LISTS[name];
  expect(
    list.length,
    `${name} is empty, so every partition and inclusion assertion over it ` +
      `would be vacuously true — the measured way a check of this file ` +
      `passes while checking nothing`,
  ).toBeGreaterThan(0);
  return list;
}

/** The ids `keys.ts` assigns to a surface: the two surface lists, in order. */
function declaredIds(): readonly string[] {
  return [
    ...read("MAIN_WINDOW_MESSAGE_IDS"),
    ...read("SEARCH_DIALOG_MESSAGE_IDS"),
  ];
}

/** The members of `a` that are not in `b`. */
function notIn(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((id) => !other.has(id));
}

/** The members `a` and `b` share, each once. */
function sharedBy(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return [...new Set(a.filter((id) => other.has(id)))];
}

/** The members of `a` that occur more than once, each once. */
function repeatedIn(a: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of a) {
    if (seen.has(id)) {
      twice.add(id);
    }
    seen.add(id);
  }
  return [...twice];
}

/** Identifiers as a readable clause for a failure message. */
function show(ids: readonly string[]): string {
  return ids.length === 0 ? "(none)" : ids.join(", ");
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/* ------------------------------------------------------------------- tests */

describe("src/i18n/keys.ts — the relations between its lists", () => {
  it("reads every list keys.ts exports, and none of them is empty", () => {
    const exported = Object.entries(keys)
      .filter(([, value]) => Array.isArray(value))
      .map(([name]) => name);
    expect(
      sorted(exported),
      `every array keys.ts exports must be registered in this file's LISTS, ` +
        `or it escapes the empty-set guard and every relation it belongs to ` +
        `goes unasserted; unregistered: ` +
        `${show(notIn(exported, Object.keys(LISTS)))}; registered but no ` +
        `longer exported: ${show(notIn(Object.keys(LISTS), exported))}`,
    ).toEqual(sorted(Object.keys(LISTS)));

    for (const name of Object.keys(LISTS) as ListName[]) {
      // `read` carries the assertion; calling it is the check.
      expect(read(name).length).toBeGreaterThan(0);
    }
  });

  it("declares no identifier twice within one list", () => {
    for (const name of Object.keys(LISTS) as ListName[]) {
      const twice = repeatedIn(read(name));
      expect(
        twice,
        `${name} must list each identifier once; repeated: ${show(twice)}`,
      ).toEqual([]);
    }
  });

  it("partitions the declared ids across the two surfaces, so no id belongs to both bundles", () => {
    const mainWindow = read("MAIN_WINDOW_MESSAGE_IDS");
    const searchDialog = read("SEARCH_DIALOG_MESSAGE_IDS");
    const both = sharedBy(mainWindow, searchDialog);
    expect(
      both,
      `MAIN_WINDOW_MESSAGE_IDS and SEARCH_DIALOG_MESSAGE_IDS must be ` +
        `disjoint: an id in two surfaces is an id in two .ftl files, and ` +
        `Fluent ids share one namespace per document, which shadows ` +
        `silently rather than erroring (docs/01 §9.3); in both: ${show(both)}`,
    ).toEqual([]);
  });

  it("keeps SHIPPED_SURFACES and MESSAGE_IDS_BY_SURFACE in step with the two surface lists", () => {
    const surfaces = read("SHIPPED_SURFACES");
    expect(
      sorted(Object.keys(keys.MESSAGE_IDS_BY_SURFACE)),
      `MESSAGE_IDS_BY_SURFACE must have an entry for exactly the surfaces ` +
        `SHIPPED_SURFACES names, since every walk over the surfaces uses one ` +
        `to index the other`,
    ).toEqual(sorted(surfaces));
    expect(
      keys.MESSAGE_IDS_BY_SURFACE.mainWindow,
      `MESSAGE_IDS_BY_SURFACE.mainWindow must expose the same ids as ` +
        `MAIN_WINDOW_MESSAGE_IDS`,
    ).toEqual([...read("MAIN_WINDOW_MESSAGE_IDS")]);
    expect(
      keys.MESSAGE_IDS_BY_SURFACE.searchDialog,
      `MESSAGE_IDS_BY_SURFACE.searchDialog must expose the same ids as ` +
        `SEARCH_DIALOG_MESSAGE_IDS`,
    ).toEqual([...read("SEARCH_DIALOG_MESSAGE_IDS")]);
  });

  it("answers surfaceOfMessage() for every declared id, with the surface whose list holds it", () => {
    const wrong: string[] = [];
    for (const surface of keys.SHIPPED_SURFACES) {
      for (const id of keys.MESSAGE_IDS_BY_SURFACE[surface]) {
        const answer = keys.surfaceOfMessage(id);
        if (answer !== surface) {
          wrong.push(`${id} -> ${String(answer)} (expected ${surface})`);
        }
      }
    }
    expect(
      wrong,
      `surfaceOfMessage() is the runtime side of the surface partition and ` +
        `must agree with the lists it is built from; disagreements: ` +
        `${show(wrong)}`,
    ).toEqual([]);

    // The other direction, probed with ids that are deliberately outside the
    // declared set: DEFERRED_ERROR_MESSAGE_IDS is messageKeys Phase 1 ships no
    // message for, so no surface may claim one.
    const claimed = read("DEFERRED_ERROR_MESSAGE_IDS").filter(
      (id) => keys.surfaceOfMessage(id) !== undefined,
    );
    expect(
      claimed,
      `surfaceOfMessage() must return undefined for an id no surface ` +
        `declares; wrongly claimed: ${show(claimed)}`,
    ).toEqual([]);
  });

  it("partitions the declared ids across KO_PENDING_REVIEW, KO_DELIBERATELY_ABSENT and KO_PRESENT", () => {
    const declared = declaredIds();
    const korean = [
      ...read("KO_PENDING_REVIEW"),
      ...read("KO_DELIBERATELY_ABSENT"),
      ...read("KO_PRESENT"),
    ];

    const unclaimed = notIn(declared, korean);
    expect(
      unclaimed,
      `KO_PENDING_REVIEW ∪ KO_DELIBERATELY_ABSENT ∪ KO_PRESENT must cover ` +
        `every declared id — each id is either awaiting Korean review, ` +
        `permanently and deliberately absent from ko-KR, or already there — ` +
        `and these declared ids are on none of the three lists: ` +
        `${show(unclaimed)}`,
    ).toEqual([]);

    const unknown = notIn(korean, declared);
    expect(
      unknown,
      `the three Korean lists must contain nothing outside the declared id ` +
        `set, or they record a ko-KR decision about a message no surface ` +
        `ships; not declared by any surface: ${show(unknown)}`,
    ).toEqual([]);
  });

  it("keeps the three Korean lists pairwise disjoint", () => {
    const pending = read("KO_PENDING_REVIEW");
    const absent = read("KO_DELIBERATELY_ABSENT");
    const present = read("KO_PRESENT");
    const pairs: readonly [
      string,
      readonly string[],
      string,
      readonly string[],
    ][] = [
      ["KO_PENDING_REVIEW", pending, "KO_DELIBERATELY_ABSENT", absent],
      ["KO_PENDING_REVIEW", pending, "KO_PRESENT", present],
      ["KO_DELIBERATELY_ABSENT", absent, "KO_PRESENT", present],
    ];
    for (const [leftName, left, rightName, right] of pairs) {
      const both = sharedBy(left, right);
      expect(
        both,
        `${leftName} and ${rightName} must be disjoint: the three lists are ` +
          `three mutually exclusive ko-KR states, and an id in two of them ` +
          `is a contradiction (an id cannot both await translation and be ` +
          `required to stay missing); in both: ${show(both)}`,
      ).toEqual([]);
    }
  });

  it("partitions the declared ids by prefix, with ERROR_MESSAGE_IDS exactly the rh-error- part", () => {
    const declared = declaredIds();
    const errorPrefixed = declared.filter((id) =>
      id.startsWith(keys.ERROR_MESSAGE_PREFIX),
    );
    const pluginPrefixed = declared.filter((id) =>
      id.startsWith(keys.MESSAGE_PREFIX),
    );

    const neither = notIn(declared, [...errorPrefixed, ...pluginPrefixed]);
    expect(
      neither,
      `every declared id must carry MESSAGE_PREFIX ("${keys.MESSAGE_PREFIX}") ` +
        `or ERROR_MESSAGE_PREFIX ("${keys.ERROR_MESSAGE_PREFIX}") — those two ` +
        `are the whole reported corpus conflict and there is no third ` +
        `namespace; with neither prefix: ${show(neither)}`,
    ).toEqual([]);

    const both = sharedBy(errorPrefixed, pluginPrefixed);
    expect(
      both,
      `no declared id may carry both prefixes, or the prefix split is not a ` +
        `partition; with both: ${show(both)}`,
    ).toEqual([]);

    const errors = read("ERROR_MESSAGE_IDS");
    expect(
      sorted(errorPrefixed),
      `ERROR_MESSAGE_IDS must be exactly the ERROR_MESSAGE_PREFIX part of ` +
        `the declared id set, so that the only ids outside the plugin prefix ` +
        `are docs/07 §10.1's messageKeys; declared but not listed: ` +
        `${show(notIn(errorPrefixed, errors))}; listed but not declared ` +
        `with that prefix: ${show(notIn(errors, errorPrefixed))}`,
    ).toEqual(sorted(errors));
  });

  it("keeps DEFERRED_ERROR_MESSAGE_IDS outside the declared ids and outside ERROR_MESSAGE_IDS", () => {
    const deferred = read("DEFERRED_ERROR_MESSAGE_IDS");
    const declared = declaredIds();

    const shipped = sharedBy(deferred, declared);
    expect(
      shipped,
      `DEFERRED_ERROR_MESSAGE_IDS is the set of messageKeys Phase 1 ships ` +
        `no message for, so it must be disjoint from the declared id set; a ` +
        `member that is also declared is a deferral that was quietly ` +
        `undone: ${show(shipped)}`,
    ).toEqual([]);

    const alsoLive = sharedBy(deferred, read("ERROR_MESSAGE_IDS"));
    expect(
      alsoLive,
      `DEFERRED_ERROR_MESSAGE_IDS and ERROR_MESSAGE_IDS must be disjoint: ` +
        `they are the deferred and the shipped halves of docs/07 §10.1's ` +
        `messageKeys, and an id in both makes the union they form ` +
        `meaningless; in both: ${show(alsoLive)}`,
    ).toEqual([]);

    const misprefixed = deferred.filter(
      (id) => !id.startsWith(keys.ERROR_MESSAGE_PREFIX),
    );
    expect(
      misprefixed,
      `every DEFERRED_ERROR_MESSAGE_IDS member is a ` +
        `ResearchHelperError.messageKey and must carry ` +
        `ERROR_MESSAGE_PREFIX ("${keys.ERROR_MESSAGE_PREFIX}"); ` +
        `misprefixed: ${show(misprefixed)}`,
    ).toEqual([]);
  });

  it("includes ARGUMENT_MESSAGE_IDS in the declared ids, every member with a surface", () => {
    const args = read("ARGUMENT_MESSAGE_IDS");
    const undeclared = notIn(args, declaredIds());
    expect(
      undeclared,
      `ARGUMENT_MESSAGE_IDS must be a subset of the declared id set: a ` +
        `message with placeables that no surface declares is arguments for a ` +
        `message no bundle can resolve. The compile-time chain for this runs ` +
        `through the generated union in typings/i10n.d.ts, which the build ` +
        `regenerates only *after* the typecheck, so it can lag a bundle ` +
        `edit; this assertion reads the lists directly. Not declared: ` +
        `${show(undeclared)}`,
    ).toEqual([]);

    const withoutSurface = args.filter(
      (id) => keys.surfaceOfMessage(id) === undefined,
    );
    expect(
      withoutSurface,
      `every message with arguments must be assigned a surface at runtime ` +
        `too, because that is the bundle a caller's lookup resolves ` +
        `against; unassigned: ${show(withoutSurface)}`,
    ).toEqual([]);
  });

  it("includes every exported single-id L10N_ constant in the surface list that owns it", () => {
    const stringExports = Object.entries(keys)
      .filter(
        ([name, value]) =>
          name.startsWith("L10N_") && typeof value === "string",
      )
      .map(([name]) => name);
    expect(
      sorted(stringExports),
      `every exported L10N_ string constant must be classified here, either ` +
        `as a single message id whose membership is asserted below or as ` +
        `documentation prose; unclassified: ` +
        `${show(
          notIn(stringExports, [
            ...Object.keys(ID_CONSTANTS),
            ...NON_ID_L10N_CONSTANTS,
          ]),
        )}`,
    ).toEqual(sorted([...Object.keys(ID_CONSTANTS), ...NON_ID_L10N_CONSTANTS]));

    const mainWindow = read("MAIN_WINDOW_MESSAGE_IDS");
    const strays = Object.entries(ID_CONSTANTS)
      .filter(([, id]) => !mainWindow.includes(id))
      .map(([name, id]) => `${name} (${id})`);
    expect(
      strays,
      `each of these constants names one id a caller passes to a lookup, so ` +
        `it must be a member of MAIN_WINDOW_MESSAGE_IDS — otherwise the id ` +
        `is in no bundle and the caller renders a blank label rather than ` +
        `failing to compile; not members: ${show(strays)}`,
    ).toEqual([]);

    expect(
      read("KO_DELIBERATELY_ABSENT"),
      `L10N_MENU_SPIKE_CREATE_ITEM must stay the deliberately absent ko-KR ` +
        `key: FR-55's "falls back to English rather than showing an ` +
        `identifier" is observable only while exactly this id is missing ` +
        `from the ko-KR bundle, and it is the fixture the integration ` +
        `spec's fallback layer is built on`,
    ).toContain(keys.L10N_MENU_SPIKE_CREATE_ITEM);
  });
});

describe("src/i18n/keys.ts — the LLM error messages P3-T05 ships", () => {
  /**
   * `P3-T05` step 7. The four LLM `messageKey`s are reachable since
   * `mapProviderError` (`src/llm/shared/errorMap.ts`) can produce their
   * classes, so they moved out of `DEFERRED_ERROR_MESSAGE_IDS`. Instances are
   * built here so the ids come from `src/core/errors.ts` itself rather than
   * from a second transcription.
   */
  const llmKeys = [
    new LLMError("openai", "m", "x"),
    new ContextLengthExceededError("openai", "m", "x"),
    new ContentFilterError("openai", "m", "x"),
    new StructuredOutputError("openai", "m", "x"),
  ].map((error) => error.messageKey);

  it("ships the four LLM messageKeys and defers only TTS, budget and policy", () => {
    expect(llmKeys).toEqual([
      "rh-error-llm",
      "rh-error-context-length",
      "rh-error-content-filter",
      "rh-error-structured-output",
    ]);
    expect(notIn(llmKeys, read("ERROR_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(llmKeys, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(llmKeys, read("DEFERRED_ERROR_MESSAGE_IDS"))).toEqual([]);
    expect(sorted(read("DEFERRED_ERROR_MESSAGE_IDS"))).toEqual(
      sorted([
        new TTSError("x").messageKey,
        new BudgetExceededError("x").messageKey,
        new PolicyViolationError("x").messageKey,
      ]),
    );
  });

  it("puts all four on KO_PRESENT once the owner reviewed the Korean (2026-10-20, G-41)", () => {
    expect(notIn(llmKeys, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(llmKeys, read("KO_PENDING_REVIEW"))).toEqual([]);
  });

  it("lists the three that take a provider or model name as argument messages", () => {
    const withArgs = llmKeys.filter((id) =>
      read("ARGUMENT_MESSAGE_IDS").includes(id),
    );
    expect(withArgs).toEqual([
      "rh-error-llm",
      "rh-error-context-length",
      "rh-error-structured-output",
    ]);
  });
});

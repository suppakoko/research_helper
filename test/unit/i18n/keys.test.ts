import { describe, expect, it } from "vitest";

import { registerProviders } from "../../../src/bootstrap/registerProviders";
import { createManualClock } from "../../../src/core/clock";
import {
  BudgetExceededError,
  ContentFilterError,
  ContextLengthExceededError,
  LLMError,
  OutputTruncatedError,
  PolicyViolationError,
  PrivacyRoutingError,
  StructuredOutputError,
  TTSError,
} from "../../../src/core/errors";
import { createLogger } from "../../../src/core/logger";
import * as keys from "../../../src/i18n/keys";
import { ANTHROPIC_DISPLAY_NAME_KEY } from "../../../src/llm/anthropic/anthropicProvider";
import { GEMINI_DISPLAY_NAME_KEY } from "../../../src/llm/gemini/geminiProvider";
import { OPENAI_DISPLAY_NAME_KEY } from "../../../src/llm/openai/openAiProvider";
import { OPENROUTER_DISPLAY_NAME_KEY } from "../../../src/llm/openrouter/openRouterProvider";
import {
  COST_DIALOG_L10N,
  USAGE_L10N,
} from "../../../src/ui/dialogs/costConfirmDialog";
import {
  SUMMARY_RESULT_L10N,
  SUMMARY_SECTION_L10N,
} from "../../../src/ui/panes/summarySection";
import {
  REMOVE_NOTES_L10N,
  SUMMARIZE_DIALOG_L10N,
} from "../../../src/ui/dialogs/summarizeDialog";
import {
  REPORT_LANGUAGES,
  REPORT_LANGUAGE_L10N,
  REPORT_WINDOW_L10N,
} from "../../../src/ui/panes/reportWindow";
import { PREFS } from "../../../src/prefs/schema";
import { mockSettings } from "../../helpers/mockLLM";

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
  // `P4-T19`: the report window's own bundle.
  REPORT_WINDOW_MESSAGE_IDS: keys.REPORT_WINDOW_MESSAGE_IDS,
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
  // `P3-T29`: FR-19's summarize entry and FR-20's removal entry.
  L10N_MENU_COLLECTION_SUMMARIZE_ALL: keys.L10N_MENU_COLLECTION_SUMMARIZE_ALL,
  L10N_MENU_COLLECTION_REMOVE_NOTES: keys.L10N_MENU_COLLECTION_REMOVE_NOTES,
  // `P4-T19`: FR-25's report entry.
  L10N_MENU_COLLECTION_REPORT: keys.L10N_MENU_COLLECTION_REPORT,
  L10N_MENU_SPIKE_CREATE_ITEM: keys.L10N_MENU_SPIKE_CREATE_ITEM,
  L10N_PROGRESS_HEADLINE: keys.L10N_PROGRESS_HEADLINE,
  // `P3-T34`: the notice that interrupted jobs resumed (`docs/07` §7.6).
  L10N_JOB_RESUMED: keys.L10N_JOB_RESUMED,
  // Item 265(a): the wall-clock budget's question (`docs/07` §7.5).
  L10N_JOB_WALL_CLOCK_BUDGET: keys.L10N_JOB_WALL_CLOCK_BUDGET,
  // `P3-T15`: the egress disclosure's two notices (`docs/09` §3.6).
  L10N_EGRESS_FIRST_JOB_NOTICE: keys.L10N_EGRESS_FIRST_JOB_NOTICE,
  L10N_EGRESS_GEMINI_FREE_TIER: keys.L10N_EGRESS_GEMINI_FREE_TIER,
  // Item 269(b): the reminder for a Gemini key declared paid (`docs/09` §3.6).
  L10N_EGRESS_GEMINI_DECLARED_PAID: keys.L10N_EGRESS_GEMINI_DECLARED_PAID,
  // `P4-T16`: a trend-report run's own notice (`docs/09` §3 row 3b).
  L10N_EGRESS_REPORT_NOTICE: keys.L10N_EGRESS_REPORT_NOTICE,
} satisfies Record<string, string>;

/** The exported `L10N_*` string constants that are not message identifiers. */
const NON_ID_L10N_CONSTANTS = ["L10N_EXPORT_TAKES_NO_PATH"];

/**
 * The lists allowed to be empty. `KO_PENDING_REVIEW` emptied on 2026-10-25,
 * when the owner reviewed the last of the coordinator's Korean drafts in chat
 * (`G-41`, `plan/00` §6 item 284(a)): "nothing waits for review" is then the
 * true state, and every assertion over it still reads the other two lists
 * through the guard. A new string goes back onto it, as its stub does.
 * *2026-10-27:* `P4-T16`'s four strings put it back to four members (item
 * 291); the exemption stays, because the owner's next review empties it
 * again. *Later on 2026-10-27:* the owner reviewed those four (item 292(a)),
 * so the list is empty again. *2026-10-29:* `P3-T28`'s and `P3-T29`'s
 * strings and the item pane's two result lines put it back (items 302, 303);
 * the owner reviewed all of them that day (items 304, 305(d)), so it is empty
 * again. *Later on 2026-10-29:* `P4-T05`'s and `P4-T19`'s eleven strings
 * put it back (item 306(b)); the owner reviewed them (item 307(f)), and
 * `P4-T05`'s stop when no theme is left (item 307(c)) is its one member.
 */
const MAY_BE_EMPTY: readonly ListName[] = ["KO_PENDING_REVIEW"];

/**
 * A list from {@link LISTS}, having first failed the test if it is empty.
 *
 * This is the "impossible by construction" half of `P1-T40`'s `Do` step 2: no
 * assertion below can read a list without going through here, so no assertion
 * below can be vacuously true for want of members — except a list on
 * {@link MAY_BE_EMPTY}.
 */
function read(name: ListName): readonly string[] {
  const list: readonly string[] = LISTS[name];
  if (MAY_BE_EMPTY.includes(name)) return list;
  expect(
    list.length,
    `${name} is empty, so every partition and inclusion assertion over it ` +
      `would be vacuously true — the measured way a check of this file ` +
      `passes while checking nothing`,
  ).toBeGreaterThan(0);
  return list;
}

/**
 * The ids `keys.ts` assigns to a surface: the surface lists, in order (three
 * since `P4-T19` shipped the report window's bundle).
 */
function declaredIds(): readonly string[] {
  return [
    ...read("MAIN_WINDOW_MESSAGE_IDS"),
    ...read("SEARCH_DIALOG_MESSAGE_IDS"),
    ...read("REPORT_WINDOW_MESSAGE_IDS"),
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
      if (MAY_BE_EMPTY.includes(name)) continue;
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

  it("partitions the declared ids across the three surfaces, so no id belongs to two bundles", () => {
    const lists = [
      "MAIN_WINDOW_MESSAGE_IDS",
      "SEARCH_DIALOG_MESSAGE_IDS",
      "REPORT_WINDOW_MESSAGE_IDS",
    ] as const;
    for (const [i, a] of lists.entries()) {
      for (const b of lists.slice(i + 1)) {
        const both = sharedBy(read(a), read(b));
        expect(
          both,
          `${a} and ${b} must be disjoint: an id in two surfaces is an id ` +
            `in two .ftl files, and Fluent ids share one namespace per ` +
            `document, which shadows silently rather than erroring (docs/01 ` +
            `§9.3); in both: ${show(both)}`,
        ).toEqual([]);
      }
    }
  });

  it("keeps SHIPPED_SURFACES and MESSAGE_IDS_BY_SURFACE in step with the three surface lists", () => {
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
    expect(
      keys.MESSAGE_IDS_BY_SURFACE.reportWindow,
      `MESSAGE_IDS_BY_SURFACE.reportWindow must expose the same ids as ` +
        `REPORT_WINDOW_MESSAGE_IDS (P4-T19)`,
    ).toEqual([...read("REPORT_WINDOW_MESSAGE_IDS")]);
    expect(sorted(surfaces)).toEqual(
      sorted(["mainWindow", "searchDialog", "reportWindow"]),
    );
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

  it("ships the four LLM messageKeys and defers only TTS and policy (budget shipped with P3-T16)", () => {
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

describe("src/i18n/keys.ts — the LLM provider names (owner, 2026-10-21, item 262(b))", () => {
  const adapterKeys = [
    OPENROUTER_DISPLAY_NAME_KEY,
    OPENAI_DISPLAY_NAME_KEY,
    ANTHROPIC_DISPLAY_NAME_KEY,
    GEMINI_DISPLAY_NAME_KEY,
  ];

  it("gives every registered adapter the one id scheme research-helper-provider-<id>", () => {
    const { registry } = registerProviders({
      logger: createLogger({
        sink: { write: () => undefined },
        clock: createManualClock(),
      }),
      settings: mockSettings({}),
    });
    const registered = registry.list();
    expect(registered).toHaveLength(4);
    for (const provider of registered) {
      expect(provider.displayNameKey, provider.id).toBe(
        `research-helper-provider-${provider.id}`,
      );
    }
    expect(sorted(registered.map((p) => p.displayNameKey))).toEqual(
      sorted(adapterKeys),
    );
  });

  it("declares all four on the main-window surface and on KO_PRESENT, never pending review", () => {
    // Provider names are not translated (`docs/08` §10.3), so `ko-KR`
    // carries them verbatim, as it does the source names.
    expect(notIn(adapterKeys, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(adapterKeys, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(adapterKeys, read("KO_PENDING_REVIEW"))).toEqual([]);
    expect(sharedBy(adapterKeys, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(
      read("MAIN_WINDOW_MESSAGE_IDS").filter((id) =>
        id.startsWith("research-helper-llm-provider-"),
      ),
    ).toEqual([]);
  });
});

describe("src/i18n/keys.ts — OpenRouter's guardrail message (owner, 2026-10-21, item 262(c))", () => {
  const key = new PrivacyRoutingError(404, "x").messageKey;

  it("ships PrivacyRoutingError's messageKey as an error id that takes an argument", () => {
    expect(key).toBe("rh-error-privacy-routing");
    expect(read("ERROR_MESSAGE_IDS")).toContain(key);
    expect(read("MAIN_WINDOW_MESSAGE_IDS")).toContain(key);
    expect(read("ARGUMENT_MESSAGE_IDS")).toContain(key);
    expect(read("DEFERRED_ERROR_MESSAGE_IDS")).not.toContain(key);
  });

  it("sits on KO_PRESENT once the owner reviewed the Korean (2026-10-21, G-41), never pending", () => {
    expect(read("KO_PRESENT")).toContain(key);
    expect(read("KO_PENDING_REVIEW")).not.toContain(key);
  });
});

describe("src/i18n/keys.ts — item 265's two strings (owner, 2026-10-21)", () => {
  const truncated = new OutputTruncatedError("openai", "m", "x").messageKey;
  const question = keys.L10N_JOB_WALL_CLOCK_BUDGET;

  it("ships OutputTruncatedError's messageKey as an error id that takes an argument (265(c))", () => {
    expect(truncated).toBe("rh-error-output-truncated");
    expect(read("ERROR_MESSAGE_IDS")).toContain(truncated);
    expect(read("MAIN_WINDOW_MESSAGE_IDS")).toContain(truncated);
    expect(read("ARGUMENT_MESSAGE_IDS")).toContain(truncated);
    expect(read("DEFERRED_ERROR_MESSAGE_IDS")).not.toContain(truncated);
  });

  it("declares the wall-clock budget's question on the main-window surface, with arguments (265(a))", () => {
    expect(question).toBe("research-helper-job-wall-clock-budget");
    expect(read("MAIN_WINDOW_MESSAGE_IDS")).toContain(question);
    expect(read("ARGUMENT_MESSAGE_IDS")).toContain(question);
    expect(read("ERROR_MESSAGE_IDS")).not.toContain(question);
  });

  it("puts both on KO_PRESENT once the owner reviewed the Korean (2026-10-21, G-41), never pending", () => {
    for (const id of [truncated, question]) {
      expect(read("KO_PRESENT")).toContain(id);
      expect(read("KO_PENDING_REVIEW")).not.toContain(id);
    }
  });
});

describe("src/i18n/keys.ts — P3-T15's two egress notices (docs/09 §3.6)", () => {
  const notices = [
    keys.L10N_EGRESS_FIRST_JOB_NOTICE,
    keys.L10N_EGRESS_GEMINI_FREE_TIER,
  ];

  it("declares both on the main-window surface, taking no argument and outside the error ids", () => {
    expect(notices).toEqual([
      "research-helper-egress-first-job-notice",
      "research-helper-egress-gemini-free-tier",
    ]);
    for (const id of notices) {
      expect(read("MAIN_WINDOW_MESSAGE_IDS")).toContain(id);
      expect(read("ARGUMENT_MESSAGE_IDS")).not.toContain(id);
      expect(read("ERROR_MESSAGE_IDS")).not.toContain(id);
    }
  });

  it("puts both on KO_PRESENT once the owner reviewed the Korean (2026-10-22, G-41), never pending", () => {
    for (const id of notices) {
      expect(read("KO_PRESENT")).toContain(id);
      expect(read("KO_PENDING_REVIEW")).not.toContain(id);
    }
  });

  it("keeps rh-error-policy deferred: PolicyViolationError gains no message with P3-T15", () => {
    const key = new PolicyViolationError("x").messageKey;
    expect(read("DEFERRED_ERROR_MESSAGE_IDS")).toContain(key);
    expect(read("ERROR_MESSAGE_IDS")).not.toContain(key);
  });
});

describe("src/i18n/keys.ts — P3-T16's budget error, cost dialog and Usage readout", () => {
  const budget = new BudgetExceededError("x").messageKey;
  const ids = [
    budget,
    ...Object.values(COST_DIALOG_L10N),
    ...Object.values(USAGE_L10N),
  ];
  const unique = [...new Set(ids)];

  it("ships rh-error-budget as an error id that takes the limit and the spend", () => {
    expect(budget).toBe("rh-error-budget");
    expect(read("ERROR_MESSAGE_IDS")).toContain(budget);
    expect(read("MAIN_WINDOW_MESSAGE_IDS")).toContain(budget);
    expect(read("ARGUMENT_MESSAGE_IDS")).toContain(budget);
    expect(read("DEFERRED_ERROR_MESSAGE_IDS")).not.toContain(budget);
  });

  it("declares all twenty-nine on the main-window surface, and only the budget id among the errors", () => {
    expect(unique).toHaveLength(29);
    expect(notIn(unique, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(unique, read("ERROR_MESSAGE_IDS"))).toEqual([budget]);
  });

  it("lists exactly the nineteen that take arguments as argument messages", () => {
    expect(sharedBy(unique, read("ARGUMENT_MESSAGE_IDS"))).toHaveLength(19);
    for (const id of [
      COST_DIALOG_L10N.title,
      COST_DIALOG_L10N.usageEstimated,
      COST_DIALOG_L10N.acknowledgeUnpriced,
      COST_DIALOG_L10N.dontAskAgain,
      COST_DIALOG_L10N.run,
      COST_DIALOG_L10N.cancel,
      COST_DIALOG_L10N.continue,
      COST_DIALOG_L10N.stop,
      USAGE_L10N.title,
      USAGE_L10N.limitOff,
    ]) {
      expect(read("ARGUMENT_MESSAGE_IDS")).not.toContain(id);
    }
  });

  it("puts all twenty-nine on KO_PRESENT once the owner reviewed the Korean (2026-10-23, G-41), never pending", () => {
    expect(notIn(unique, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(unique, read("KO_PENDING_REVIEW"))).toEqual([]);
  });

  it("still defers rh-error-policy: the cost dialog renders no refusal (P3-T15 finding 4)", () => {
    expect(read("DEFERRED_ERROR_MESSAGE_IDS")).toContain(
      new PolicyViolationError("x").messageKey,
    );
  });
});

describe("src/i18n/keys.ts — the Gemini declared-paid reminder (plan/00 §6 item 269(b))", () => {
  const reminder = keys.L10N_EGRESS_GEMINI_DECLARED_PAID;

  it("declares it on the main-window surface, taking no argument and outside the error ids", () => {
    expect(reminder).toBe("research-helper-egress-gemini-declared-paid");
    expect(read("MAIN_WINDOW_MESSAGE_IDS")).toContain(reminder);
    expect(read("ARGUMENT_MESSAGE_IDS")).not.toContain(reminder);
    expect(read("ERROR_MESSAGE_IDS")).not.toContain(reminder);
  });

  it("puts it on KO_PRESENT once the owner reviewed the Korean (2026-10-23, G-41), never pending", () => {
    expect(read("KO_PRESENT")).toContain(reminder);
    expect(read("KO_PENDING_REVIEW")).not.toContain(reminder);
  });
});

describe("src/i18n/keys.ts — P3-T03's degradation dialog (docs/09 §1.7)", () => {
  // `SECRET_BACKEND_DIALOG_L10N` in src/ui/dialogs/secretBackendDialog.ts is
  // typed against these; test/unit/zotero/sessionStore.test.ts ties the two.
  const dialog = [
    "research-helper-secret-backend-title",
    "research-helper-secret-backend-explain",
    "research-helper-secret-backend-session",
    "research-helper-secret-backend-none",
    "research-helper-secret-backend-accept",
    "research-helper-secret-backend-decline",
  ];

  it("declares all six on the main-window surface, taking no argument and outside the error ids", () => {
    expect(notIn(dialog, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(dialog, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(dialog, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts all six on KO_PRESENT once the owner reviewed the Korean (2026-10-22, G-41), never pending", () => {
    expect(notIn(dialog, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(dialog, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P3-T04's LLM provider blocks, tier-2 badge and restore notice", () => {
  // `PREFERENCES_L10N` in src/ui/prefs/preferencesPane.ts is typed against
  // these; test/unit/ui/preferencesPane.test.ts ties the pane to them.
  const pane = [
    "research-helper-prefs-backend-session",
    "research-helper-prefs-restore-note",
    "research-helper-prefs-providers",
    "research-helper-prefs-active-provider",
    "research-helper-prefs-api-key",
    "research-helper-prefs-model",
    "research-helper-prefs-base-url",
    "research-helper-prefs-base-url-saved",
    "research-helper-prefs-base-url-default",
    "research-helper-prefs-base-url-not-https",
    "research-helper-prefs-base-url-trailing-slash",
    "research-helper-prefs-base-url-invalid",
    "research-helper-prefs-gemini-paid-tier",
    "research-helper-prefs-gemini-paid-tier-note",
  ];

  it("declares all fourteen on the main-window surface, taking no argument and outside the error ids", () => {
    expect(notIn(pane, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(pane, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(pane, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts all fourteen on KO_PRESENT once the owner reviewed the Korean (2026-10-23, G-41), never pending", () => {
    expect(notIn(pane, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(pane, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — docs/09 §1.8's tier-2 replacements (owner, 2026-10-23, items 274(a) and 275(b))", () => {
  // The pane shows them in place of research-helper-prefs-risk-1 and -risk-4
  // under the session badge; test/unit/ui/preferencesPane.test.ts ties them
  // to docs/09.
  const ids = [
    "research-helper-prefs-risk-1-session",
    "research-helper-prefs-risk-4-session",
  ];

  it("declares both on the main-window surface, taking no argument and outside the error ids", () => {
    expect(notIn(ids, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(ids, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(ids, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts both on KO_PRESENT once the owner reviewed the Korean (2026-10-23, G-41, item 275), never pending", () => {
    expect(notIn(ids, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(ids, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P3-T14's LLM Test, model suggestions and price table", () => {
  // `PREFERENCES_L10N` in src/ui/prefs/preferencesPane.ts is typed against
  // these; test/unit/ui/preferencesPane.test.ts ties the pane to them.
  const withArguments = [
    "research-helper-prefs-test-ok-rate-limited",
    "research-helper-prefs-models-as-of",
    "research-helper-prefs-models-stale",
    "research-helper-prefs-price-row",
    "research-helper-prefs-price-row-no-cached",
  ];
  const plain = [
    "research-helper-prefs-model-suggestions",
    "research-helper-prefs-prices",
    "research-helper-prefs-prices-note",
    "research-helper-prefs-price-model",
    "research-helper-prefs-price-input",
    "research-helper-prefs-price-output",
    "research-helper-prefs-price-cached",
    "research-helper-prefs-price-as-of",
    "research-helper-prefs-price-save",
    "research-helper-prefs-price-remove",
    "research-helper-prefs-price-saved",
    "research-helper-prefs-price-removed",
    "research-helper-prefs-price-invalid",
    "research-helper-prefs-price-refused",
    "research-helper-prefs-price-unavailable",
  ];
  const all = [...withArguments, ...plain];

  it("declares all twenty on the main-window surface, outside the error ids; five take arguments", () => {
    expect(all).toHaveLength(20);
    expect(notIn(all, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(withArguments, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(plain, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(all, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts all twenty on KO_PRESENT once the owner reviewed the Korean (2026-10-25, G-41), never pending", () => {
    expect(notIn(all, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(all, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — the out-of-credit Test line (owner, 2026-10-23, plan/00 §6 item 279(a))", () => {
  const id = "research-helper-prefs-test-ok-no-credit";

  it("declares it on the main-window surface with one argument, outside the error ids", () => {
    expect(notIn([id], read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(notIn([id], read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy([id], read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts it, and the reworded key-present line (item 279(d)), on KO_PRESENT once the owner reviewed the Korean (2026-10-25, G-41)", () => {
    const reviewed = [id, "research-helper-prefs-key-present"];
    expect(notIn(reviewed, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(reviewed, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P3-T27's relevance-screening strings (docs/08 §4.2, docs/12 §3)", () => {
  // src/ui/viewModels/searchImportViewModel.ts builds the three with
  // arguments; addon/content/searchDialog.xhtml and .js carry the rest.
  const withArguments = [
    "research-helper-search-screening-count",
    "research-helper-search-screening-unscored",
    "research-helper-search-row-relevance",
  ];
  const plain = [
    "research-helper-search-screening-enable",
    "research-helper-search-screening-threshold-label",
    "research-helper-search-screening-threshold-input",
    "research-helper-search-screening-show-excluded",
    "research-helper-search-screening-failed",
  ];
  const all = [...withArguments, ...plain];

  it("declares all eight on the search-window surface, outside the error ids; three take arguments", () => {
    expect(all).toHaveLength(8);
    expect(notIn(all, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(all, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(withArguments, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(plain, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(all, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts all eight on KO_PRESENT once the owner reviewed the Korean (2026-10-25, G-41), never pending", () => {
    expect(notIn(all, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(all, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — the screening cost line (owner, 2026-10-24, plan/00 §6 item 281(b))", () => {
  const both = [
    "research-helper-search-screening-cost",
    "research-helper-search-screening-cost-unpriced",
  ];

  it("declares both on the search-window surface, with arguments, outside the error ids", () => {
    expect(notIn(both, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(both, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(both, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(both, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts both on KO_PRESENT once the owner reviewed the Korean (2026-10-25, G-41), never pending", () => {
    expect(notIn(both, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(both, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P4-T16's report notice and cost-dialog lines (plan/00 §6 items 291, 292(a))", () => {
  const four = [
    "research-helper-egress-report-notice",
    "research-helper-cost-report-summaries",
    "research-helper-cost-report-writing",
    "research-helper-cost-report-review",
  ];

  it("declares all four on the main window, with arguments, outside the error ids", () => {
    expect(notIn(four, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(four, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(four, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(four, read("ERROR_MESSAGE_IDS"))).toEqual([]);
    expect(keys.L10N_EGRESS_REPORT_NOTICE).toBe(four[0]);
  });

  it("puts all four on KO_PRESENT once the owner reviewed the Korean (2026-10-27, G-41, item 292(a)), never pending", () => {
    expect(notIn(four, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(four, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P3-T28's item-pane summary section (docs/08 §3; plan/00 §6 item 302)", () => {
  const fifteen = Object.values(SUMMARY_SECTION_L10N);

  it("names fifteen distinct ids, every one the section's own", () => {
    expect(new Set(fifteen).size).toBe(15);
    for (const id of fifteen) {
      expect(id.startsWith("research-helper-itempane-")).toBe(true);
    }
  });

  it("declares all fifteen on the main-window surface, taking no argument and outside the error ids", () => {
    expect(notIn(fifteen, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(fifteen, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    // Model output never reaches a Fluent argument (summarySection.ts).
    expect(sharedBy(fifteen, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(fifteen, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  // Moved 2026-10-29: the owner approved the Korean (G-41, plan/00 §6 item 304).
  it("puts all fifteen on KO_PRESENT now the owner reviewed the Korean (G-41, item 304), none still pending", () => {
    expect(notIn(fifteen, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(fifteen, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P3-T29's summarize window and removal command (docs/08 §2.5; plan/00 §6 item 302)", () => {
  const window = Object.values(SUMMARIZE_DIALOG_L10N).filter(
    (id) => id !== keys.L10N_JOB_WALL_CLOCK_BUDGET,
  );
  const removal = Object.values(REMOVE_NOTES_L10N);
  const pending = [
    keys.L10N_MENU_COLLECTION_REMOVE_NOTES,
    ...window,
    ...removal,
  ];
  const withArguments = [
    "research-helper-summarize-collection",
    "research-helper-summarize-stage",
    "research-helper-summarize-progress",
    "research-helper-summarize-remaining",
    "research-helper-summarize-row",
    "research-helper-summarize-counts",
    "research-helper-summarize-outcome",
    "research-helper-summarize-key-needed",
    "research-helper-summarize-export-outcome",
    "research-helper-remove-notes-confirm",
    "research-helper-remove-notes-none",
    "research-helper-remove-notes-done",
  ];

  it("names twenty-four new ids, plus the summarize-all label docs/08 §10.2 already gives", () => {
    expect(new Set(pending).size).toBe(24);
    expect(keys.L10N_MENU_COLLECTION_SUMMARIZE_ALL).toBe(
      "research-helper-menu-collection-summarize-all",
    );
  });

  it("declares all twenty-five on the main-window surface, outside the error ids; twelve take arguments", () => {
    const all = [...pending, keys.L10N_MENU_COLLECTION_SUMMARIZE_ALL];
    expect(notIn(all, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(all, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(all, read("ERROR_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(withArguments, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(all, read("ARGUMENT_MESSAGE_IDS"))).toHaveLength(12);
  });

  // Moved 2026-10-29: the owner approved the Korean (G-41, plan/00 §6 item 304).
  it("puts the twenty-four and the owner-written menu label on KO_PRESENT now the owner reviewed the Korean (G-41, item 304)", () => {
    expect(notIn(pending, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(pending, read("KO_PENDING_REVIEW"))).toEqual([]);
    expect(read("KO_PRESENT")).toContain(
      keys.L10N_MENU_COLLECTION_SUMMARIZE_ALL,
    );
  });
});

describe("src/i18n/keys.ts — the item pane's result lines (plan/00 §6 item 303(a), (b))", () => {
  const two = Object.values(SUMMARY_RESULT_L10N);

  it("names two distinct ids, neither one of the section's fifteen", () => {
    expect(new Set(two).size).toBe(2);
    expect(sharedBy(two, Object.values(SUMMARY_SECTION_L10N))).toEqual([]);
  });

  it("declares both on the main-window surface, each taking $reason, outside the error ids", () => {
    expect(notIn(two, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(two, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(two, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(two, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  // Moved 2026-10-29: the owner approved the Korean (G-41, plan/00 §6 item 305(d)).
  it("puts both on KO_PRESENT now the owner reviewed the Korean (G-41, item 305(d)), neither still pending", () => {
    expect(notIn(two, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(two, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P4-T05's stop for too many themes (plan/00 §6 items 292(d), 306(b))", () => {
  // TOO_MANY_THEMES_L10N in src/pipeline/trendReport/cluster.ts; trendCluster.test.ts pins the two equal.
  const one = ["research-helper-report-stopped-too-many-themes"];

  it("declares it on the main window, taking $themes and $max, outside the error ids", () => {
    expect(notIn(one, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(one, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(notIn(one, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(one, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  // Moved 2026-10-29: the owner approved the Korean (G-41, plan/00 §6 item 307(f)).
  it("puts it on KO_PRESENT now the owner reviewed the Korean (G-41, item 307(f)), not still pending", () => {
    expect(notIn(one, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(one, read("KO_PENDING_REVIEW"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P4-T05's stop when no theme is left (plan/00 §6 item 307(c))", () => {
  // NO_THEMES_L10N in src/pipeline/trendReport/cluster.ts; trendCluster.test.ts pins the two equal.
  const one = ["research-helper-report-stopped-no-themes"];

  it("declares it on the main window beside the too-many-themes stop, with no argument, outside the error ids", () => {
    expect(notIn(one, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(one, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(one, read("REPORT_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(one, read("ARGUMENT_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(one, read("ERROR_MESSAGE_IDS"))).toEqual([]);
  });

  it("puts it on KO_PENDING_REVIEW, not KO_PRESENT, until the owner reviews the Korean (G-41)", () => {
    expect(notIn(one, read("KO_PENDING_REVIEW"))).toEqual([]);
    expect(sharedBy(one, read("KO_PRESENT"))).toEqual([]);
  });
});

describe("src/i18n/keys.ts — P4-T19's report window and its menu entry (docs/08 §2.5, §6.4; plan/00 §6 item 306(b))", () => {
  const ten = Object.values(REPORT_WINDOW_L10N);

  it("names ten distinct ids, exactly the report window's surface list", () => {
    expect(new Set(ten).size).toBe(10);
    expect(sorted(ten)).toEqual(sorted(read("REPORT_WINDOW_MESSAGE_IDS")));
  });

  it("declares them on the reportWindow surface only, outside the error ids; two take arguments", () => {
    for (const id of ten)
      expect(keys.surfaceOfMessage(id)).toBe("reportWindow");
    expect(sharedBy(ten, read("MAIN_WINDOW_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(ten, read("SEARCH_DIALOG_MESSAGE_IDS"))).toEqual([]);
    expect(sharedBy(ten, read("ERROR_MESSAGE_IDS"))).toEqual([]);
    expect(sorted(sharedBy(ten, read("ARGUMENT_MESSAGE_IDS")))).toEqual(
      sorted([REPORT_WINDOW_L10N.collection, REPORT_WINDOW_L10N.model]),
    );
  });

  // Moved 2026-10-29: the owner approved the Korean (G-41, plan/00 §6 item 307(f)).
  it("puts all ten on KO_PRESENT now the owner reviewed the Korean (G-41, item 307(f)), none still pending", () => {
    expect(notIn(ten, read("KO_PRESENT"))).toEqual([]);
    expect(sharedBy(ten, read("KO_PENDING_REVIEW"))).toEqual([]);
  });

  it("puts the menu label on the main window and on KO_PRESENT: docs/08 §10.2 gives the owner's Korean", () => {
    const label = keys.L10N_MENU_COLLECTION_REPORT;
    expect(label).toBe("research-helper-menu-collection-report");
    expect(keys.surfaceOfMessage(label)).toBe("mainWindow");
    expect(read("KO_PRESENT")).toContain(label);
    expect(read("KO_PENDING_REVIEW")).not.toContain(label);
  });

  it("offers exactly reportLanguage's values in the selector, each with its own label id", () => {
    expect([...REPORT_LANGUAGES]).toEqual([...PREFS.reportLanguage.values]);
    expect(Object.keys(REPORT_LANGUAGE_L10N)).toEqual([...REPORT_LANGUAGES]);
    expect(new Set(Object.values(REPORT_LANGUAGE_L10N)).size).toBe(4);
    for (const id of Object.values(REPORT_LANGUAGE_L10N)) {
      expect(ten).toContain(id);
    }
  });
});

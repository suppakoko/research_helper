/**
 * `plan/10` `P7-T12` — the error-message audit against `docs/10` NFR-14.
 *
 * NFR-14: "Every user-facing error shall state what failed, which service was
 * involved, and one concrete next action." {@link AUDIT} is the audit's table
 * and this test's data: for every id on `ERROR_MESSAGE_IDS`, what raises it,
 * how its `en-US` message names the service (the argument it takes, or a name
 * written into the sentence), and the next action the message must contain.
 * Each message's first sentence says what failed; it is `docs/08` §8.3's
 * "Message (en-US)" column where that table has a row.
 *
 * The decisions behind the table are `plan/00` §6 item 389: no message gained
 * an argument (d); `rh-error-policy` names Research Helper's privacy mode (e);
 * where the failure is the user's own item or collection, that is what is
 * named (d). `rh-error-cancelled` is outside the audit:
 * `OperationCancelledError` is not user-facing.
 *
 * The `ko-KR` side is `G-41`'s: each id whose `draft` is true was given the
 * coordinator's Korean as a commented draft, not adopted (item 389(b)); the
 * owner approved all 23 on 2026-11-17, so each is now live under a one-line
 * provenance comment and no draft is left (item 389(b), recorded in
 * plan/reports/ko-review-389.ftl).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OperationCancelledError } from "../../../src/core/errors";
import {
  DEFERRED_ERROR_MESSAGE_IDS,
  ERROR_MESSAGE_IDS,
  KO_PENDING_REVIEW,
  KO_PRESENT,
} from "../../../src/i18n/keys";

type Service =
  /** The message takes this argument, the service's display name or host. */
  | { readonly arg: string }
  /** The message names the service in its own words. */
  | { readonly name: string };

interface AuditRow {
  readonly id: string;
  /** The class, or the code path, that raises the message. */
  readonly raisedBy: string;
  readonly service: Service;
  /** Contained, ignoring case, in the message (in every variant of a select). */
  readonly nextAction: string;
  /** P7-T12 drafted new Korean for it, which the owner approved on 2026-11-17 (item 389(b)). */
  readonly draft: boolean;
}

const PREFS = "Research Helper's preferences";

const AUDIT: readonly AuditRow[] = [
  {
    id: "rh-error-configuration",
    raisedBy: "ConfigurationError",
    service: { name: "Research Helper" },
    nextAction: `Check ${PREFS}`,
    draft: true,
  },
  {
    id: "rh-error-missing-credential",
    raisedBy: "MissingCredentialError",
    service: { arg: "provider" },
    nextAction: `Add the key in ${PREFS}`,
    draft: true,
  },
  {
    id: "rh-error-network",
    raisedBy: "NetworkError",
    service: { arg: "host" },
    nextAction: "Check your internet connection",
    draft: true,
  },
  {
    id: "rh-error-offline",
    raisedBy: "OfflineError",
    service: { name: "Zotero" },
    nextAction: "Connect to the internet",
    draft: true,
  },
  {
    id: "rh-error-timeout",
    raisedBy: "TimeoutError",
    service: { arg: "host" },
    nextAction: "Try again in a few minutes",
    draft: true,
  },
  {
    id: "rh-error-auth",
    raisedBy: "AuthenticationError",
    service: { arg: "provider" },
    nextAction: `Check the key in ${PREFS}`,
    draft: true,
  },
  {
    id: "rh-error-forbidden",
    raisedBy: "AuthorizationError",
    service: { arg: "provider" },
    nextAction: "Check the key's permissions",
    draft: true,
  },
  {
    id: "rh-error-rate-limit",
    raisedBy: "RateLimitError",
    service: { arg: "provider" },
    nextAction: "Retrying in",
    draft: false,
  },
  {
    id: "rh-error-quota",
    raisedBy: "QuotaExceededError",
    service: { arg: "provider" },
    nextAction: "Add credit in your",
    draft: true,
  },
  {
    id: "rh-error-upstream",
    raisedBy: "UpstreamServerError",
    service: { arg: "database" },
    nextAction: "Try this database again later",
    draft: true,
  },
  {
    id: "rh-error-bad-request",
    raisedBy: "BadRequestError",
    service: { arg: "database" },
    nextAction: "report the problem if it happens again",
    draft: true,
  },
  {
    id: "rh-error-source",
    raisedBy: "SourceError",
    service: { arg: "database" },
    nextAction: "Try again later",
    draft: true,
  },
  {
    id: "rh-error-parse",
    raisedBy: "ParseError",
    service: { arg: "database" },
    nextAction: "report the problem if it happens again",
    draft: true,
  },
  {
    id: "rh-error-zotero",
    raisedBy: "ZoteroApiError",
    service: { name: "Zotero" },
    nextAction: "restart Zotero",
    draft: true,
  },
  {
    id: "rh-error-storage",
    raisedBy: "StorageError",
    service: { name: "Research Helper" },
    nextAction: "Check that the disk has free space",
    draft: true,
  },
  {
    id: "rh-error-cancelled",
    raisedBy: "OperationCancelledError (not user-facing; outside the audit)",
    service: { name: "" },
    nextAction: "",
    draft: false,
  },
  {
    id: "rh-error-llm",
    raisedBy: "LLMError",
    service: { arg: "provider" },
    nextAction: `choose another model in ${PREFS}`,
    draft: true,
  },
  {
    id: "rh-error-context-length",
    raisedBy: "ContextLengthExceededError",
    service: { arg: "model" },
    nextAction: "Choose a model that reads longer text",
    draft: true,
  },
  {
    id: "rh-error-content-filter",
    raisedBy: "ContentFilterError",
    service: { name: "AI provider" },
    nextAction: "choose a model from another AI provider",
    draft: true,
  },
  {
    id: "rh-error-structured-output",
    raisedBy: "StructuredOutputError",
    service: { arg: "provider" },
    nextAction: `choose another model in ${PREFS}`,
    draft: true,
  },
  {
    id: "rh-error-output-truncated",
    raisedBy: "OutputTruncatedError",
    service: { arg: "model" },
    nextAction: "choose a model with a larger output limit",
    draft: true,
  },
  {
    id: "rh-error-privacy-routing",
    raisedBy: "PrivacyRoutingError",
    service: { name: "OpenRouter" },
    nextAction: "Choose a different model",
    draft: false,
  },
  {
    id: "rh-error-budget",
    raisedBy: "BudgetExceededError",
    service: { name: "Research Helper" },
    nextAction: "Raise Research Helper's limit to continue",
    draft: true,
  },
  {
    id: "rh-error-seed-gone",
    raisedBy: "SeedUnresolvedError (gone), createRelatedPipeline",
    service: { name: "library" },
    nextAction: "Choose another item",
    draft: true,
  },
  {
    id: "rh-error-seed-no-identifier",
    raisedBy: "SeedUnresolvedError, resolveSeed",
    service: { name: "item" },
    nextAction: "Add one of them to the item",
    draft: false,
  },
  {
    id: "rh-error-seed-no-match",
    raisedBy: "SeedUnresolvedError, resolveSeed",
    service: { name: "item" },
    nextAction: "Add one of them to the item",
    draft: false,
  },
  {
    id: "rh-error-recommend-too-few-items",
    raisedBy: "createRecommendPipeline (no class)",
    service: { name: "collection" },
    nextAction: "Add items to the collection",
    draft: true,
  },
  {
    id: "rh-error-tts",
    raisedBy: "TTSError, classifyAudioFailure",
    service: { name: "Gemini" },
    nextAction: "script as text",
    draft: false,
  },
  {
    id: "rh-error-policy",
    raisedBy: "PolicyViolationError",
    service: { name: "Research Helper" },
    nextAction: `Check the privacy mode in ${PREFS}`,
    draft: true,
  },
];

/** Exempt from the three-part rule, with the reason in its row. */
const EXEMPT = ["rh-error-cancelled"];

/**
 * Every argument an error message may take. Display names, hosts, database and
 * model names, counts, statuses and pre-formatted money; never a key, a URL
 * query or a header (`P7-T12`'s `Do NOT`).
 */
const ALLOWED_ARGS = [
  "provider",
  "host",
  "database",
  "model",
  "status",
  "seconds",
  "limit",
  "spent",
  "count",
  "reason",
  "imported",
];

const HERE = dirname(fileURLToPath(import.meta.url));
const bundle = (locale: string): string =>
  readFileSync(
    resolve(
      HERE,
      `../../../addon/locale/${locale}/research-helper-mainWindow.ftl`,
    ),
    "utf8",
  ).replace(/\r\n/g, "\n");
const EN = bundle("en-US");
const KO = bundle("ko-KR");

/** One message's value: its first line, then each indented line or closing brace. */
function message(text: string, id: string): string | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${id} =`));
  const first = lines[at];
  if (first === undefined) return undefined;
  const value = [first.slice(`${id} =`.length).trim()];
  for (const line of lines.slice(at + 1)) {
    if (!/^[ \t]/.test(line) && !line.startsWith("}")) break;
    if (line.trim() !== "") value.push(line.trim());
  }
  return value.filter((part) => part !== "").join("\n");
}

/** The texts a reader can see: each variant of a select, or the one value. */
function variants(value: string): readonly string[] {
  const picked = value
    .split("\n")
    .map((line) => /^\*?\[[^\]]+\]\s*(.*)$/.exec(line)?.[1])
    .filter((text): text is string => text !== undefined);
  return picked.length > 0 ? picked : [value];
}

const lower = (text: string): string => text.toLowerCase();

describe("P7-T12: every rh-error-* message against NFR-14", () => {
  it("audits exactly the shipped error ids, and defers none", () => {
    expect(DEFERRED_ERROR_MESSAGE_IDS).toEqual([]);
    expect(AUDIT.map((row) => row.id).sort()).toEqual(
      [...ERROR_MESSAGE_IDS].sort(),
    );
  });

  it("finds an en-US message for every row", () => {
    const missing = AUDIT.filter((row) => message(EN, row.id) === undefined);
    expect(missing.map((row) => row.id)).toEqual([]);
  });

  it.each(AUDIT.filter((row) => !EXEMPT.includes(row.id)))(
    "$id names its service and ends in the table's next action",
    ({ id, service, nextAction }) => {
      const value = message(EN, id) ?? "";
      for (const text of variants(value)) {
        if ("arg" in service) {
          expect(text, `${id} takes { $${service.arg} }`).toContain(
            `{ $${service.arg} }`,
          );
        } else {
          expect(text, `${id} names ${service.name}`).toContain(service.name);
        }
        expect(lower(text), `${id}'s next action`).toContain(lower(nextAction));
        expect(lower(text)).not.toContain("an error occurred");
      }
    },
  );

  it("exempts only rh-error-cancelled, whose class is not user-facing", () => {
    expect(EXEMPT).toEqual(["rh-error-cancelled"]);
    expect(new OperationCancelledError({ kind: "user" }).userFacing).toBe(
      false,
    );
  });

  it("takes no argument outside the allowed list: no key, URL query or header", () => {
    const strays: string[] = [];
    for (const { id } of AUDIT) {
      for (const [, name] of (message(EN, id) ?? "").matchAll(
        /\{\s*\$([A-Za-z_-]+)/g,
      )) {
        if (name === undefined || !ALLOWED_ARGS.includes(name)) {
          strays.push(`${id}: $${String(name)}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it("ships the owner-approved Korean live for each new or changed message, under its provenance line (G-41, item 389(b))", () => {
    const PROVENANCE =
      "# Korean drafted by the coordinator and reviewed by the owner on 2026-11-17 (G-41, plan/00 §6 item 389).";
    const lines = KO.split("\n");
    const unadopted = AUDIT.filter((row) => row.draft).filter((row) => {
      const at = lines.findIndex((line) => line.startsWith(`${row.id} = `));
      const live = at >= 1 ? lines[at] : undefined;
      return (
        live === undefined ||
        lines[at - 1] !== PROVENANCE ||
        // The approved text is one line, and carries the next action.
        live.trim() === `${row.id} =`
      );
    });
    expect(unadopted.map((row) => row.id)).toEqual([]);
    expect(AUDIT.filter((row) => row.draft)).toHaveLength(23);
    expect(lines.filter((line) => line === PROVENANCE)).toHaveLength(23);
    // No draft of item 389 is left commented beside a live entry.
    expect(KO).not.toContain("not adopted; G-41, plan/00 §6 item 389");
  });

  it("ships rh-error-policy with live Korean, off KO_PENDING_REVIEW (G-41, item 389(b))", () => {
    expect(message(KO, "rh-error-policy")).toBe(
      "개인정보 모드에서 허용하지 않는 요청이라 Research Helper가 보내기 전에 멈췄습니다. Research Helper 설정에서 개인정보 모드를 확인하세요.",
    );
    expect(KO_PENDING_REVIEW).not.toContain("rh-error-policy");
    expect(KO_PRESENT).toContain("rh-error-policy");
  });
});

/**
 * What an audio run tells the user before it spends, and what it refuses:
 * the notice naming both hosts, the Gemini key's tier as the user declared
 * it, the once-asked tier question, and strict mode's refusal.
 *
 * **Scope.** `plan/09` `P6-T15` steps 1–5; `docs/09` §3 row 5 (clarified
 * 2026-11-16), §3.4 rules 4–5, §3.5's Gemini row as corrected 2026-11-16, and
 * §3.6 items 2–3; owner, `plan/00` §6 items 378(b) and 379. The dialog side is
 * `buildAudioDialogModel` in `src/ui/dialogs/costConfirmDialog.ts`.
 *
 * **Caller:** `audioReportPipeline.ts` (`P6-T16`), which calls
 * {@link assertAudioAllowed} in `prepare` before any call, builds the
 * disclosure with {@link audioEgressNotice} for each of its two dialog moments,
 * and, on a confirmed dialog, writes the answer with {@link recordTierAnswer}.
 * Nothing constructs it yet.
 *
 * ## Decisions (each DECIDED 2026-11-17, coordinator, under `plan/00` §6 item 313)
 *
 * 1. **`gemini.paidTier` is the live declaration.** The tier is `paid`
 *    exactly when it is on. A `paid` answer sets it, so the two agree; a user
 *    who later clears the pane's box gets the free-tier warning back although
 *    `gemini.tierAnswer` still reads `paid` (`docs/09` §3.6 item 3: "Turning
 *    the declaration off brings the free-tier warning back"; §3.4 rule 4's
 *    note keeps the pane's checkbox as the way to change the answer).
 * 2. **The question is offered while `gemini.tierAnswer` is `""` and the key
 *    is not already declared paid.** A key declared paid from the pane has its
 *    answer.
 * 3. **"Don't know" is pre-selected, and the answer is written only when the
 *    dialog is confirmed**, as `privacy.egressAcknowledged` is; a cancel writes
 *    nothing and the question comes back. `free` and `unknown` leave
 *    `gemini.paidTier` alone (it is off whenever the question is offered).
 * 4. **The refusal is a `PolicyViolationError`** whose context carries
 *    {@link AUDIO_TIER_REFUSAL_REASON}; {@link isAudioTierRefusal} tells the
 *    audio surface to show `L10N_AUDIO_TIER_REFUSED`, which names the reason
 *    and both ways out, because `rh-error-policy` is still deferred
 *    (`DEFERRED_ERROR_MESSAGE_IDS`). Paid is allowed in every mode, strict
 *    included (owner, item 270).
 * 5. **The first-use record is a fingerprint in the job's egress log**
 *    (`docs/07` §4.5's note of 2026-11-17): 16 hexadecimal characters of
 *    SHA-256 over a fixed label, the `SecretId` and the key. Short enough that
 *    `redactRecord` keeps it (its hexadecimal pattern starts at 32), far too
 *    short to give the key back. The key is read by the caller for the call it
 *    is about to make; this module never stores, logs or returns it.
 * 6. **No "don't ask again" for audio.** Every Gemini disclosure carries the
 *    warning or the reminder, so the box could never apply; the dialog omits it.
 */

import { sha256Hex } from "../../core/cache/keys";
import { PolicyViolationError } from "../../core/errors";
import type { JobRecord } from "../../core/jobQueue/jobRecord";
import type { SecretId } from "../../core/secretStore";
import type { GeminiTier } from "../../llm/gemini/tierDetect";
import { getPref, setPref } from "../../prefs";
import {
  buildEgressDisclosure,
  readEgressLog,
  type AudioScriptCall,
  type EgressDisclosure,
  type EgressDisclosureDeps,
} from "../shared/egressDisclosure";
import { isPrivacyMode, type PrivacyMode } from "../shared/privacyPolicy";

// ===========================================================================
// 1. The tier (docs/09 §3.4 rule 4's notes of 2026-11-16)
// ===========================================================================

/** `gemini.tierAnswer`'s values (`docs/07` §8.5); `""` is "not yet asked". */
export type GeminiTierAnswer = "" | "paid" | "free" | "unknown";

/** The three answers the question offers, in the order shown. */
export const OFFERED_TIER_ANSWERS = ["paid", "free", "unknown"] as const;

/** One of {@link OFFERED_TIER_ANSWERS}. */
export type OfferedTierAnswer = (typeof OFFERED_TIER_ANSWERS)[number];

/** The pre-selected answer: "don't know", which counts as free (item 378(b)). */
export const PRESELECTED_TIER_ANSWER: OfferedTierAnswer = "unknown";

/** True for one of {@link OFFERED_TIER_ANSWERS}. */
export function isOfferedTierAnswer(
  value: unknown,
): value is OfferedTierAnswer {
  return (
    typeof value === "string" &&
    (OFFERED_TIER_ANSWERS as readonly string[]).includes(value)
  );
}

/** The key's tier for an audio run, and whether to ask the question. */
export interface AudioTierState {
  /** `paid` exactly when `gemini.paidTier` is on (decision 1). */
  readonly tier: GeminiTier;
  /** `gemini.tierAnswer`; an unrecognised stored value reads as `""`. */
  readonly answer: GeminiTierAnswer;
  /** Offer the question in this confirmation (decision 2). */
  readonly askTierQuestion: boolean;
}

/** What {@link audioTierState} reads; the preferences by default. */
export interface AudioTierPrefs {
  readonly paidTier?: () => boolean;
  readonly tierAnswer?: () => string;
}

/**
 * The tier the audio confirmation goes by, read now (never cached: either
 * preference can change between two runs).
 *
 * @param prefs - see {@link AudioTierPrefs}
 * @returns the state
 */
export function audioTierState(prefs: AudioTierPrefs = {}): AudioTierState {
  const paid = (prefs.paidTier?.() ?? getPref("geminiPaidTier")) === true;
  const raw: unknown = prefs.tierAnswer?.() ?? getPref("geminiTierAnswer");
  const answer: GeminiTierAnswer = isOfferedTierAnswer(raw) ? raw : "";
  return {
    tier: paid ? "paid" : "free-or-unknown",
    answer,
    askTierQuestion: answer === "" && !paid,
  };
}

/** What {@link recordTierAnswer} writes through; the preferences by default. */
export interface TierAnswerWriter {
  readonly tierAnswer?: (answer: OfferedTierAnswer) => void;
  readonly paidTier?: (paid: true) => void;
}

/**
 * Record the answer a **confirmed** dialog carried (decision 3): write
 * `gemini.tierAnswer`, and for `paid` also turn `gemini.paidTier` on. No
 * answer — the dialog did not ask, or was cancelled — writes nothing.
 *
 * @param answer - the outcome's `tierAnswer`
 * @param write - see {@link TierAnswerWriter}
 */
export function recordTierAnswer(
  answer: OfferedTierAnswer | undefined,
  write: TierAnswerWriter = {},
): void {
  if (!isOfferedTierAnswer(answer)) return;
  if (write.tierAnswer !== undefined) write.tierAnswer(answer);
  else setPref("geminiTierAnswer", answer);
  if (answer !== "paid") return;
  if (write.paidTier !== undefined) write.paidTier(true);
  else setPref("geminiPaidTier", true);
}

// ===========================================================================
// 2. The refusal (docs/09 §3.5's Gemini row as corrected 2026-11-16)
// ===========================================================================

/** The context `reason` of strict mode's refusal. */
export const AUDIO_TIER_REFUSAL_REASON = "audio-free-or-unknown-tier";

/** What an allowed audio run must show, and that it waits for the answer. */
export interface AudioTierCheck {
  /** The warning for a free or unknown key; the reminder for a declared one. */
  readonly notice: "free-tier-warning" | "declared-paid-reminder";
  /** Always: the run proceeds only after the user confirms (item 379). */
  readonly requiresConfirmation: true;
}

/**
 * Whether the mode in force lets an audio run use a key of this tier.
 *
 * | tier | strict | balanced | full |
 * |---|---|---|---|
 * | paid | reminder, confirm | reminder, confirm | reminder, confirm |
 * | free or unknown | **refused** | warning, confirm | warning, confirm |
 *
 * An unknown mode counts as strict.
 *
 * @param mode - the mode in force (`PrivacyPolicy.mode`)
 * @param tier - {@link AudioTierState.tier}
 * @returns what the confirmation shows
 * @throws PolicyViolationError in strict mode with a free or unknown key,
 *   before any call
 */
export function assertAudioAllowed(
  mode: PrivacyMode,
  tier: GeminiTier,
): AudioTierCheck {
  if (tier === "paid") {
    return { notice: "declared-paid-reminder", requiresConfirmation: true };
  }
  const known: PrivacyMode = isPrivacyMode(mode) ? mode : "strict";
  if (known === "strict") {
    throw new PolicyViolationError(
      "audio is refused in strict privacy mode: the Gemini key may be on the " +
        "free tier (docs/09 §3.5)",
      { mode: known, providerId: "gemini", reason: AUDIO_TIER_REFUSAL_REASON },
    );
  }
  return { notice: "free-tier-warning", requiresConfirmation: true };
}

/**
 * Whether `error` is {@link assertAudioAllowed}'s refusal, which the audio
 * surface shows as `L10N_AUDIO_TIER_REFUSED` (decision 4).
 */
export function isAudioTierRefusal(error: unknown): boolean {
  return (
    error instanceof PolicyViolationError &&
    error.context["reason"] === AUDIO_TIER_REFUSAL_REASON
  );
}

// ===========================================================================
// 3. The first use with a key (docs/09 §3.4 rule 5)
// ===========================================================================

/** Hexadecimal characters kept: under `KEY_PATTERNS`' 32 (decision 5). */
export const AUDIO_KEY_FINGERPRINT_LENGTH = 16;

/** Keeps this hash apart from every other use of SHA-256 in the plugin. */
const FINGERPRINT_LABEL = "research-helper/audio-destination/v1";

/**
 * The key's fingerprint for the first-use record: 16 hexadecimal characters
 * of SHA-256 over the label, the secret id and the key. Not reversible, and
 * never the key.
 *
 * @param secretId - the keystore id the key was read from
 * @param key - the key, in memory for the call about to be made
 * @returns the fingerprint
 */
export function audioKeyFingerprint(secretId: SecretId, key: string): string {
  return sha256Hex(JSON.stringify([FINGERPRINT_LABEL, secretId, key])).slice(
    0,
    AUDIO_KEY_FINGERPRINT_LENGTH,
  );
}

/**
 * The fingerprints earlier audio jobs recorded, each once, from their egress
 * logs (`readEgressLog`). `P6-T16` passes the stored audio jobs.
 *
 * @param records - job records, as read back
 * @returns the distinct fingerprints, in order of first appearance
 */
export function knownAudioKeyFingerprints(
  records: readonly Pick<JobRecord, "input">[],
): string[] {
  const out: string[] = [];
  for (const record of records) {
    const fingerprint = readEgressLog(record)?.audio?.keyFingerprint;
    if (typeof fingerprint === "string" && !out.includes(fingerprint)) {
      out.push(fingerprint);
    }
  }
  return out;
}

// ===========================================================================
// 4. The notice (docs/09 §3 row 5; plan/09 §0.2 item 21)
// ===========================================================================

/** What {@link audioEgressNotice} is built from. */
export interface AudioEgressNoticeInput {
  /** The mode in force for the job. */
  readonly privacyMode: PrivacyMode;
  /** The TTS model the run will use (`P6-T05`'s `resolveModel`). */
  readonly ttsModelId: string;
  /** The script call, when due (no stored script for the language). */
  readonly scriptCall: AudioScriptCall | undefined;
  /** {@link audioKeyFingerprint} of the key the run will use. */
  readonly keyFingerprint: string;
  /** {@link knownAudioKeyFingerprints} of the earlier audio jobs. */
  readonly knownKeyFingerprints: readonly string[];
}

/**
 * The audio run's disclosure: provider `gemini`, the TTS model, no items, the
 * audio notice first (both hosts when a script call is due, Gemini's alone
 * otherwise), then the first-job notice while unacknowledged, then the Gemini
 * warning or the declared-paid reminder.
 *
 * @param input - see {@link AudioEgressNoticeInput}
 * @param deps - {@link buildEgressDisclosure}'s
 * @returns the disclosure the dialog embeds
 */
export function audioEgressNotice(
  input: AudioEgressNoticeInput,
  deps: EgressDisclosureDeps,
): EgressDisclosure {
  return buildEgressDisclosure(
    {
      providerId: "gemini",
      modelId: input.ttsModelId,
      privacyMode: input.privacyMode,
      items: [],
      audio: {
        ...(input.scriptCall !== undefined && { scriptCall: input.scriptCall }),
        keyFingerprint: input.keyFingerprint,
        knownKeyFingerprints: input.knownKeyFingerprints,
      },
    },
    deps,
  );
}

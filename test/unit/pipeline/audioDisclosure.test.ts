/**
 * `plan/09` `P6-T15` — the audio run's disclosure, tier and refusal
 * (`src/pipeline/audioReport/disclosure.ts`, and the audio members of
 * `src/pipeline/shared/egressDisclosure.ts`). Plain Node; no window, no
 * network, no LLM call. Every key below is SYNTHETIC and never a real one.
 */

import { describe, expect, it } from "vitest";

import { PolicyViolationError, redact } from "../../../src/core/errors";
import { redactRecord } from "../../../src/core/provenance";
import {
  L10N_EGRESS_AUDIO_NOTICE,
  L10N_EGRESS_FIRST_JOB_NOTICE,
  L10N_EGRESS_GEMINI_DECLARED_PAID,
  L10N_EGRESS_GEMINI_FREE_TIER,
} from "../../../src/i18n/keys";
import {
  AUDIO_KEY_FINGERPRINT_LENGTH,
  AUDIO_TIER_REFUSAL_REASON,
  assertAudioAllowed,
  audioEgressNotice,
  audioKeyFingerprint,
  audioTierState,
  isAudioTierRefusal,
  knownAudioKeyFingerprints,
  recordTierAnswer,
  type AudioEgressNoticeInput,
  type OfferedTierAnswer,
} from "../../../src/pipeline/audioReport/disclosure";
import type { AudioPlan } from "../../../src/model/audio";
import { ZERO_SPEND } from "../../../src/pipeline/shared/budget";
import {
  buildEgressDisclosure,
  egressLogEntry,
  mustAskConfirmation,
  readEgressLog,
  withEgressLog,
  type EgressDisclosure,
} from "../../../src/pipeline/shared/egressDisclosure";
import type { PrivacyMode } from "../../../src/pipeline/shared/privacyPolicy";
import {
  buildAudioDialogModel,
  decideCostDialog,
} from "../../../src/ui/dialogs/costConfirmDialog";

const KEY_A = "synthetic-test-key-aaaa-not-real";
const KEY_B = "synthetic-test-key-bbbb-not-real";
const HOSTS: Record<string, string> = {
  gemini: "generativelanguage.googleapis.com",
  openrouter: "openrouter.ai",
};
const SCRIPT_CALL = {
  providerId: "openrouter",
  modelId: "mock-report",
} as const;

type TierCase = "paid" | "free" | "unknown" | "unanswered";

/** The two preferences for each case: a `paid` answer also set the box. */
function prefsFor(tier: TierCase): { paid: boolean; answer: string } {
  switch (tier) {
    case "paid":
      return { paid: true, answer: "paid" };
    case "free":
      return { paid: false, answer: "free" };
    case "unknown":
      return { paid: false, answer: "unknown" };
    case "unanswered":
      return { paid: false, answer: "" };
  }
}

function notice(
  overrides: Partial<AudioEgressNoticeInput> = {},
  options: { paid?: boolean; acknowledged?: boolean } = {},
): EgressDisclosure {
  return audioEgressNotice(
    {
      privacyMode: "balanced",
      ttsModelId: "mock-tts",
      scriptCall: SCRIPT_CALL,
      keyFingerprint: audioKeyFingerprint("llm.gemini", KEY_A),
      knownKeyFingerprints: [],
      ...overrides,
    },
    {
      baseUrls: { effectiveHost: (id) => HOSTS[id] ?? "unknown.invalid" },
      egressAcknowledged: () => options.acknowledged ?? true,
      geminiPaidTier: () => options.paid ?? false,
    },
  );
}

describe("P6-T15 — strict, balanced and full × paid, free, unknown, unanswered", () => {
  const modes: readonly PrivacyMode[] = ["strict", "balanced", "full"];
  const tiers: readonly TierCase[] = ["paid", "free", "unknown", "unanswered"];
  const rows = modes.flatMap((mode) => tiers.map((tier) => ({ mode, tier })));

  it.each(rows)(
    "$mode × $tier matches docs/09 §3.5's Gemini row and items 378(b) and 379",
    ({ mode, tier }) => {
      const prefs = prefsFor(tier);
      const state = audioTierState({
        paidTier: () => prefs.paid,
        tierAnswer: () => prefs.answer,
      });
      expect(state.tier).toBe(tier === "paid" ? "paid" : "free-or-unknown");

      if (mode === "strict" && tier !== "paid") {
        // Refused before any call, with the reason in the context.
        let thrown: unknown;
        try {
          assertAudioAllowed(mode, state.tier);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(PolicyViolationError);
        expect(isAudioTierRefusal(thrown)).toBe(true);
        expect((thrown as PolicyViolationError).context).toEqual({
          mode: "strict",
          providerId: "gemini",
          reason: AUDIO_TIER_REFUSAL_REASON,
        });
        return;
      }

      const check = assertAudioAllowed(mode, state.tier);
      expect(check.requiresConfirmation).toBe(true);
      expect(check.notice).toBe(
        tier === "paid" ? "declared-paid-reminder" : "free-tier-warning",
      );

      const disclosure = notice({ privacyMode: mode }, { paid: prefs.paid });
      // Paid: the one-line reminder and no warning, in every mode. Otherwise
      // the warning and no reminder.
      expect(disclosure.noticeIds.includes(L10N_EGRESS_GEMINI_FREE_TIER)).toBe(
        tier !== "paid",
      );
      expect(
        disclosure.noticeIds.includes(L10N_EGRESS_GEMINI_DECLARED_PAID),
      ).toBe(tier === "paid");

      // A stored "don't ask again" for this provider and mode skips nothing.
      const decision = mustAskConfirmation(disclosure, {
        providerId: "gemini",
        privacyMode: mode,
        fullText: false,
      });
      expect(decision.ask).toBe(true);
      expect(decision.reasons).toContain(
        tier === "paid" ? "gemini-declared-paid" : "gemini-free-tier",
      );

      // The job waits for the confirmation: no "don't ask again" box, and only
      // an explicit accept runs anything.
      const model = buildAudioDialogModel(
        {
          step: "audio",
          plan: TINY_PLAN,
          warnings: [],
          disclosure,
          providerName: "Google Gemini",
          confirmAboveCents: 200,
          ceiling: undefined,
          session: ZERO_SPEND,
          askTierQuestion: state.askTierQuestion,
          pricesAsOfEpochMs: undefined,
        },
        "en-US",
      );
      expect(model.dontAskAgain).toBeUndefined();
      expect(decideCostDialog(model, undefined)).toEqual({ kind: "cancelled" });
      expect(decideCostDialog(model, { accepted: false })).toEqual({
        kind: "cancelled",
      });
      expect(
        decideCostDialog(model, { accepted: true, acknowledged: true }),
      ).toMatchObject({
        kind: "run",
        dontAskAgain: false,
      });
      // The tier question only while the answer is "".
      expect(model.tierQuestion !== undefined).toBe(tier === "unanswered");
    },
  );

  it("an unknown mode counts as strict", () => {
    expect(() =>
      assertAudioAllowed("lenient" as PrivacyMode, "free-or-unknown"),
    ).toThrow(PolicyViolationError);
    expect(assertAudioAllowed("lenient" as PrivacyMode, "paid").notice).toBe(
      "declared-paid-reminder",
    );
  });

  it("isAudioTierRefusal accepts the refusal only, not any policy error", () => {
    expect(isAudioTierRefusal(new PolicyViolationError("x"))).toBe(false);
    expect(isAudioTierRefusal(new Error(AUDIO_TIER_REFUSAL_REASON))).toBe(
      false,
    );
  });
});

describe("P6-T15 — the tier (decisions 1–3)", () => {
  it("a cleared pane box brings the warning back even after a 'paid' answer", () => {
    const state = audioTierState({
      paidTier: () => false,
      tierAnswer: () => "paid",
    });
    expect(state).toEqual({
      tier: "free-or-unknown",
      answer: "paid",
      askTierQuestion: false,
    });
  });

  it("a key declared paid from the pane is not asked", () => {
    expect(
      audioTierState({ paidTier: () => true, tierAnswer: () => "" })
        .askTierQuestion,
    ).toBe(false);
  });

  it("an unrecognised stored answer reads as not yet asked", () => {
    expect(
      audioTierState({ paidTier: () => false, tierAnswer: () => "maybe" }),
    ).toEqual({ tier: "free-or-unknown", answer: "", askTierQuestion: true });
  });

  it("the question appears once, writes gemini.tierAnswer, and never again once answered", () => {
    const stored = { answer: "", paid: false };
    const prefs = {
      paidTier: () => stored.paid,
      tierAnswer: () => stored.answer,
    };
    const writer = {
      tierAnswer: (a: OfferedTierAnswer) => {
        stored.answer = a;
      },
      paidTier: (p: true) => {
        stored.paid = p;
      },
    };
    const dialog = () =>
      buildAudioDialogModel(
        {
          step: "audio",
          plan: TINY_PLAN,
          warnings: [],
          disclosure: notice({}, { paid: stored.paid }),
          providerName: "Google Gemini",
          confirmAboveCents: 200,
          ceiling: undefined,
          session: ZERO_SPEND,
          askTierQuestion: audioTierState(prefs).askTierQuestion,
          pricesAsOfEpochMs: undefined,
        },
        "en-US",
      );

    // Cancelled: nothing is written, so the question comes back.
    const first = dialog();
    expect(first.tierQuestion).toBeDefined();
    const cancelled = decideCostDialog(first, {
      accepted: false,
      tierAnswer: "free",
    });
    expect(cancelled).toEqual({ kind: "cancelled" });
    recordTierAnswer(
      cancelled.kind === "run" ? cancelled.tierAnswer : undefined,
      writer,
    );
    expect(stored).toEqual({ answer: "", paid: false });

    // Confirmed with "free": written once; the box stays off.
    const second = dialog();
    expect(second.tierQuestion).toBeDefined();
    const run = decideCostDialog(second, {
      accepted: true,
      acknowledged: true,
      tierAnswer: "free",
    });
    expect(run).toMatchObject({ kind: "run", tierAnswer: "free" });
    recordTierAnswer(run.kind === "run" ? run.tierAnswer : undefined, writer);
    expect(stored).toEqual({ answer: "free", paid: false });

    // Never again; and a confirmed dialog without a question records nothing.
    const third = dialog();
    expect(third.tierQuestion).toBeUndefined();
    const again = decideCostDialog(third, {
      accepted: true,
      acknowledged: true,
      tierAnswer: "paid",
    });
    expect(again).not.toHaveProperty("tierAnswer");
    recordTierAnswer(
      again.kind === "run" ? again.tierAnswer : undefined,
      writer,
    );
    expect(stored).toEqual({ answer: "free", paid: false });
  });

  it("'paid' also turns gemini.paidTier on; 'unknown' and 'free' leave it", () => {
    const writes: string[] = [];
    const writer = {
      tierAnswer: (a: OfferedTierAnswer) => writes.push(`answer=${a}`),
      paidTier: (p: true) => writes.push(`paid=${String(p)}`),
    };
    recordTierAnswer("paid", writer);
    recordTierAnswer("unknown", writer);
    recordTierAnswer("free", writer);
    recordTierAnswer(undefined, writer);
    recordTierAnswer("maybe" as OfferedTierAnswer, writer);
    expect(writes).toEqual([
      "answer=paid",
      "paid=true",
      "answer=unknown",
      "answer=free",
    ]);
  });

  it("confirming without a choice records the pre-selected 'don't know'", () => {
    const model = buildAudioDialogModel(
      {
        step: "audio",
        plan: TINY_PLAN,
        warnings: [],
        disclosure: notice(),
        providerName: "Google Gemini",
        confirmAboveCents: 200,
        ceiling: undefined,
        session: ZERO_SPEND,
        askTierQuestion: true,
        pricesAsOfEpochMs: undefined,
      },
      "en-US",
    );
    expect(
      decideCostDialog(model, { accepted: true, acknowledged: true }),
    ).toMatchObject({
      tierAnswer: "unknown",
    });
    expect(
      decideCostDialog(model, {
        accepted: true,
        acknowledged: true,
        tierAnswer: "bogus",
      }),
    ).toMatchObject({ tierAnswer: "unknown" });
  });
});

describe("P6-T15 — the notice names both hosts when a script call is due", () => {
  it("due: the audio notice first, both hosts and the script model", () => {
    const disclosure = notice({}, { acknowledged: false });
    expect(disclosure.noticeIds[0]).toBe(L10N_EGRESS_AUDIO_NOTICE);
    expect(disclosure.noticeIds[1]).toBe(L10N_EGRESS_FIRST_JOB_NOTICE);
    expect(disclosure.providerId).toBe("gemini");
    expect(disclosure.host).toBe(HOSTS["gemini"]);
    expect(disclosure.itemCount).toBe(0);
    expect(disclosure.audio?.scriptCall).toEqual({
      ...SCRIPT_CALL,
      host: HOSTS["openrouter"],
    });
    const model = buildAudioDialogModel(
      {
        step: "audio",
        plan: TINY_PLAN,
        warnings: [],
        disclosure,
        providerName: "Google Gemini",
        confirmAboveCents: 200,
        ceiling: undefined,
        session: ZERO_SPEND,
        askTierQuestion: false,
        pricesAsOfEpochMs: undefined,
      },
      "en-US",
    );
    expect(model.notices[0]).toEqual({
      id: L10N_EGRESS_AUDIO_NOTICE,
      args: {
        script: "due",
        scriptModel: "mock-report",
        scriptHost: "openrouter.ai",
        ttsModel: "mock-tts",
        ttsHost: "generativelanguage.googleapis.com",
      },
    });
  });

  it("stored: one host, Gemini's", () => {
    const disclosure = notice({ scriptCall: undefined });
    expect(disclosure.audio).not.toHaveProperty("scriptCall");
    const model = buildAudioDialogModel(
      {
        step: "audio",
        plan: TINY_PLAN,
        warnings: [],
        disclosure,
        providerName: "Google Gemini",
        confirmAboveCents: 200,
        ceiling: undefined,
        session: ZERO_SPEND,
        askTierQuestion: false,
        pricesAsOfEpochMs: undefined,
      },
      "en-US",
    );
    expect(model.notices[0]?.args).toEqual({
      script: "stored",
      scriptModel: "",
      scriptHost: "",
      ttsModel: "mock-tts",
      ttsHost: "generativelanguage.googleapis.com",
    });
  });
});

describe("P6-T15 — the first use with a key (docs/09 §3.4 rule 5)", () => {
  it("the fingerprint is 16 hexadecimal characters, per key, and never the key", () => {
    const a = audioKeyFingerprint("llm.gemini", KEY_A);
    const b = audioKeyFingerprint("llm.gemini", KEY_B);
    expect(a).toMatch(
      new RegExp(`^[0-9a-f]{${AUDIO_KEY_FINGERPRINT_LENGTH}}$`),
    );
    expect(AUDIO_KEY_FINGERPRINT_LENGTH).toBe(16);
    expect(a).not.toBe(b);
    expect(audioKeyFingerprint("llm.gemini", KEY_A)).toBe(a);
    expect(audioKeyFingerprint("tts.gemini", KEY_A)).not.toBe(a);
    // Under KEY_PATTERNS' 32-character hexadecimal run: redact keeps it.
    expect(redact(a)).toBe(a);
  });

  it("first use forces the question with first-audio-key; a known key does not add it", () => {
    const fp = audioKeyFingerprint("llm.gemini", KEY_A);
    const first = notice({ keyFingerprint: fp, knownKeyFingerprints: [] });
    expect(first.audio?.firstUseWithKey).toBe(true);
    expect(mustAskConfirmation(first, undefined).reasons).toContain(
      "first-audio-key",
    );
    const known = notice({ keyFingerprint: fp, knownKeyFingerprints: [fp] });
    expect(known.audio?.firstUseWithKey).toBe(false);
    expect(mustAskConfirmation(known, undefined).reasons).not.toContain(
      "first-audio-key",
    );
  });

  it("the egress log carries the record, the gate keeps it, and it holds no key", () => {
    const keyShaped = `AIza${"Q".repeat(35)}`; // SYNTHETIC, key-shaped
    const fp = audioKeyFingerprint("llm.gemini", keyShaped);
    const entry = egressLogEntry(notice({ keyFingerprint: fp }), 1_000);
    expect(entry.audio).toEqual({
      scriptCall: { ...SCRIPT_CALL, host: "openrouter.ai" },
      keyFingerprint: fp,
      firstUseWithKey: true,
    });
    const input = withEgressLog({ reportId: "r-1" }, entry);
    const gated = redactRecord(input);
    expect(gated.mark.partlyRedacted).toBe(false);
    expect(gated.record).toEqual(input);
    const text = JSON.stringify(gated.record);
    expect(text).not.toContain(keyShaped);
    expect(text).not.toContain("AIza");
    // Read back by the next run's lookup.
    expect(knownAudioKeyFingerprints([{ input: gated.record }])).toEqual([fp]);
  });

  it("knownAudioKeyFingerprints reads each fingerprint once and skips other jobs", () => {
    const a = audioKeyFingerprint("llm.gemini", KEY_A);
    const b = audioKeyFingerprint("llm.gemini", KEY_B);
    const job = (fp: string) => ({
      input: withEgressLog(
        {},
        egressLogEntry(notice({ keyFingerprint: fp }), 1),
      ),
    });
    const { audio: _dropped, ...plainEntry } = egressLogEntry(notice(), 1);
    void _dropped;
    const summarize = { input: withEgressLog({}, plainEntry) };
    expect(
      knownAudioKeyFingerprints([
        job(a),
        { input: null },
        summarize,
        job(b),
        job(a),
      ]),
    ).toEqual([a, b]);
    expect(readEgressLog({ input: "x" })).toBeUndefined();
  });

  it("a disclosure built without an audio input has no audio member and no audio notice", () => {
    const plain = buildEgressDisclosure(
      {
        providerId: "gemini",
        modelId: "mock-tts",
        privacyMode: "balanced",
        items: [],
      },
      {
        baseUrls: { effectiveHost: () => "generativelanguage.googleapis.com" },
        egressAcknowledged: () => true,
        geminiPaidTier: () => false,
      },
    );
    expect(plain).not.toHaveProperty("audio");
    expect(plain.noticeIds).not.toContain(L10N_EGRESS_AUDIO_NOTICE);
    expect(egressLogEntry(plain, 1)).not.toHaveProperty("audio");
    expect(mustAskConfirmation(plain, undefined).reasons).not.toContain(
      "first-audio-key",
    );
  });
});

// ---------------------------------------------------------------------------
// A small plan for the dialog checks: two chunks, priced as unknown.
// ---------------------------------------------------------------------------

const TINY_PLAN: AudioPlan = {
  reportId: "r-1",
  language: "en",
  model: "mock-tts",
  voice: "Charon",
  stylePrefix: "Read this aloud.",
  chunks: [
    { index: 0, text: "One sentence here.", separator: " ", chars: 18 },
    { index: 1, text: "Another sentence.", separator: "", chars: 17 },
  ],
  totalChars: 35,
  estimatedSeconds: 3,
  estimatedBytes: 3 * 48_000 + 44,
  mode: "imported",
  cost: {
    usd: undefined,
    inputTokens: 30,
    outputTokens: 87,
    rateMeasuredOnModel: false,
  },
};

# Human Gates

> **What this file is.** Every point in the v1 plan where a human must act and an
> agent must stop. `plan/README.md` §1 states the rule; this file enumerates the
> instances.
>
> **The rule.** An agent that reaches a gate **stops and reports**. It does not
> work around the gate, does not simulate the human's decision, does not enter a
> credential, and does not proceed on an assumption about what the human would
> have chosen. A task card whose completion appears to require crossing a gate is
> a defect in the task card (`plan/README.md` §5 rule 5 states the same principle
> for credentials specifically).
>
> **What a gate is.** A point where the blocking input is a credential, money, a
> GUI interaction, a real-account action, a legal or policy judgement, a language
> judgement, a domain judgement, or a destructive operation against real user
> data. Product decisions appear here only where nothing can be decomposed until
> they land.
>
> **Owning documents.** Values, policies and rationale live in `docs/`; this file
> references them and never restates a figure. Phase-level decision points are
> `docs/11` §5's; security open decisions are `docs/09` §8's; the release
> obligations are `docs/13` §7 and §8's.
>
> **Last updated:** 2026-09-09 · **Status:** no gate has been passed; no code
> exists.

---

## 1. Start order — the table that matters

Gates are **grouped by phase** in §2–§10, but they must be **started** in this
order. Several of the earliest gates block phases that are months away; starting
them when the blocked phase begins is the single most avoidable schedule failure
in this plan.

| Start | Gate | Title | Blocks | Lead time |
|---|---|---|---|---|
| **Phase 0, week 1** | **G-03** | **Apply for the Semantic Scholar API key** | **Phase 5** | **Weeks — the longest in the plan (`docs/11` R-3)** |
| ~~Phase 0, week 1~~ | ~~G-32~~ | ~~Confirm MIT with the institution's IP office~~ **CLOSED 2026-09-09** | nothing | — |
| Phase 0, week 1 | G-04 | Register the NCBI `tool`/`email` pair; obtain the optional NCBI key | Phase 1 politeness; Phase 7 release | **IN MOTION 2026-10-08** — owner registering; the optional key is deliberately deferred until a surface exists to enter one |
| Phase 0, week 1 | G-01 | Create the GitHub repository and grant permissions | Everything (`P0-T01`) | Minutes |
| Phase 0, week 1 | G-02 | Provide the Zotero 10 install, dev profile and `.env` paths | Phase 0 entirely | Hours |
| Phase 0, week 1 | G-05 | Create provider accounts and obtain LLM/TTS keys | V-7, V-10, Phase 3 | Hours; Gemini billing linkage may take longer |
| Phase 0, week 1 | G-09 | Provide macOS and Linux machines, one without libsecret | V-16, V-5, Phase 7 QA | Days to weeks if hardware must be arranged |
| Phase 0, week 1 | G-11 | Line up a native Korean speaker | V-10, and again in Phases 6 and 7 | Scheduling a person; days |
| Phase 0, week 1 | G-31 | Line up a Korean-speaking researcher for prompt review | Phase 7 | Scheduling; days to weeks |
| **Before release** | **G-41** | **Review the Phase 1 `ko-KR` UI bundle — 82 ids, re-counted from `src/i18n/keys.ts` on 2026-10-08** | **the v1.0 release** | **DEFERRED 2026-10-08 by the owner — English only until then; a Korean-locale user sees English for 79 of 84 strings, not a broken screen** |
| Phase 0, week 1 | G-12 | Assemble the 40-PDF IMRaD fixture set | Phase 3 ship, Phase 4 | Days of the human's own time |
| Phase 0, early | G-06 | Acknowledge the Gemini free-tier data-training terms | Any Gemini call, incl. V-10 | Minutes, but must precede the first call |
| Phase 0, early | G-07 | Approve the first paid API call and the spike spend | V-7, V-10 | Minutes |
| Phase 0 | G-08 | Install the XPI by hand; run the teardown cycles | V-1, V-4, Phase 0 DoD | Minutes per cycle |
| Phase 0 | G-40 | Approve the two throwaway public releases of the V-18 update dry run | V-18, R-15 | Minutes, once G-01 is done |
| Phase 0, end | G-10 | Decide the Linux-without-libsecret fallback tier | Phase 3 prefs design | Product-owner turnaround |
| ~~Before Phase 1~~ | ~~G-13~~ | ~~Confirm the 3-year window is soft~~ **CLOSED 2026-10-08 — soft; the build was already soft** | nothing | — |
| Phase 1 | G-14 | Accept and monitor the maintainer-address obligation | Ongoing from the first outbound request | Ongoing |
| Phase 1 | G-15 | Authorize the first import into a real Zotero library | Phase 1 DoD | **ANSWERED 2026-10-08** — a separate practice profile, never the research library; the DoD says a real *term*, not a real *library* |
| Before Phase 2 | G-16 | Decide the preprint/published merge policy | Dedup engine | Product-owner turnaround |
| Phase 2 | G-17 | Label the ≥ 200-pair deduplication corpus | Phase 2 DoD | Days of the human's own time |
| Phase 3 | G-18 | Enter API keys into the prefs pane | Phase 3 DoD, all LLM features | Minutes |
| Phase 3 | G-19 | Accept the residual key-storage risk statement | Phase 3 ship | **ACCEPTED 2026-10-23** — the five paragraphs, plus a tier-2 sentence shown in place of paragraph 1 (`plan/00` §6 item 274(a)) |
| Phase 3 | G-20 | Decide whether the spend ceilings ship non-zero | Phase 3 prefs defaults | **DECIDED 2026-10-23** — the session ceiling ships at 500 cents (US $5), the per-run ceiling stays 0 (`plan/00` §6 item 271(b)); every later change is still this gate |
| Phase 3 | G-21 | Approve the first real summarization job's cost | Phase 3 DoD | Minutes |
| Phase 3 | G-22 | Decide the R-19b outcome if the detector misses its threshold | Phase 3 ship, Phase 4 shape | Product-owner turnaround |
| Phase 4 | G-23 | Curate the 3 evaluation collections and expected themes | Phase 4 DoD | Days of domain time |
| Phase 4 | G-24 | Domain spot-check of a generated trend report | Phase 4 DoD, R-6/R-7 | Hours |
| Phase 4 | G-25 | Approve any write into a group library | Group-library paths | Minutes |
| Phase 4 | G-42 | Approve the first real report run's cost estimate, and each paid Phase 4 run after it | Phase 4 DoD (`P4-T23`, `P4-T24`, `P4-T25`) | Minutes per run; **added 2026-10-26** (`plan/00` §6 item 286) |
| Phase 5 | G-26 | Enter the Semantic Scholar key, or decide to ship degraded | Phase 5 scope | Minutes once G-03 resolves |
| Phase 5 | G-27 | Judge a collection profile and its recommendations | Phase 5 DoD | Hours of domain time |
| Phase 5 | G-43 | Approve the first real recommendation run's cost estimate, and each paid Phase 5 run after it | Phase 5 DoD (`P5-T30`) | Minutes per run; **added 2026-11-02** (`plan/00` §6 item 321(a)) |
| Before Phase 6 | ~~G-28~~ | ~~Decide the audio register and the Korean-script source~~ **Decided 2026-11-16** (`plan/00` §6 item 378(a); register under item 313) | Script prompts (`plan/09` `P6-T06`, `P6-T08`) | Done |
| Phase 6 | G-29 | Approve the paid calibration call that measures the audio token rate — **measured 2026-09-29 by `P0-T25` on one model; re-verification due by 2026-12-01** (note under G-29, 2026-11-16) | Phase 6 cost model (`plan/09` `P6-T10`) | Minutes |
| Phase 6 | G-30 | Rate 3 Korean audio samples | Phase 6 DoD (`plan/09` `P6-T19`) | Hours, native speaker |
| Phase 7 | G-33 | Screen-reader smoke test (NVDA, VoiceOver) | NFR-13 | Hours, on two OSes |
| Phase 7 | G-34 | Provide three-OS QA machines and a ~10k-item library copy | `docs/13` §8 | Days if hardware must be arranged |
| Phase 7 | G-35 | Publish the GitHub Release and update manifest | v1.0 | Minutes |
| Phase 7 | G-36 | Announce in the Zotero Forums; submit to community lists | R-20 | Hours; list turnaround unknown |
| Phase 7 | G-37 | Sign off the release checklist, including NFR waivers | v1.0 | Hours |
| Ongoing | G-38 | Any destructive action against the user's real Zotero library | Any phase | Per occurrence |
| Ongoing | G-39 | Rotate or revoke a key after suspected exposure | Any phase | Per occurrence |

**Read this table as:** the nine still-open `Phase 0, week 1` rows should all be
in motion during Phase 0's first week, even though six of them — G-03, G-04,
G-09, G-11, G-12 and G-31 — block work in phases that will not start for months.
G-32 was the tenth row and is closed; it blocked Phase 7, so its closure removes
one of that months-away set rather than one of the near-term rows. Only G-01,
G-02 and G-05 pay off inside Phase 0 itself.

**The months in question got longer, not shorter.** `docs/11` §1's 2026-09-09
re-estimate puts the whole plan at ≈ 7–10 months of full-time work rather than
4–5, which pushes every downstream phase further out in calendar time. That is
slack for the approval queues behind these rows, not permission to open them
later: an application submitted in month 3 is still an application submitted in
month 3.

---

## 2. Phase 0 gates

### G-01 — Create the GitHub repository and grant permissions

**Blocks:** everything. `plan/README.md` §6 records that the repository is not yet
initialised and that `P0-T01` creates it.

**What the human must do.** Create the repository under the `suppakoko` account,
set the default branch to `main`, grant push access to whoever executes the plan,
and apply `docs/09` §6.3's release-integrity rules: XPIs are built in CI from a
tagged commit and never from a maintainer's laptop; who may push tags and publish
releases is restricted; and the release workflow file itself requires review,
because a PR editing `.github/workflows/release.yml` is a supply-chain event.
Decide public or private at creation.

**Why an agent cannot do it.** It is a real-account action on a third-party
service under the user's identity, and it sets permissions that govern every
later release. Creating accounts and modifying account settings are outside what
an agent may do on the user's behalf.

**Lead time.** Minutes, once the human sits down.

**If it is not done.** `P0-T01` cannot start; there is no CI, no `update_url`
host, and no release path. No degraded path — nothing in the plan proceeds.

**Agent behaviour on reaching it.** Stop. Report: the repository name expected by
D9's plugin ID and by `docs/13` §6.3's `update_link` examples, the branch and
permission settings needed, and that `P0-T01` is blocked until a clone URL exists.

---

### G-02 — Provide the Zotero 10 install, dev profile and `.env` paths

**Blocks:** all of Phase 0; V-1, V-2, V-3, V-4.

**What the human must do.** Confirm the installed Zotero build (D1 records the
owner runs 10.0.1), create a dedicated development profile separate from the real
library, and supply the values `docs/11` §1 Phase 0 names —
`ZOTERO_PLUGIN_ZOTERO_BIN_PATH`, `ZOTERO_PLUGIN_PROFILE_PATH`, and optionally
`ZOTERO_PLUGIN_DATA_DIR`.

**Why an agent cannot do it.** Zotero's profile manager is a GUI, and choosing
*which* profile is safe to develop against is a judgement about the human's own
data — getting it wrong points hot-reload at the real library (see G-38).

**Lead time.** Hours.

**If it is not done.** Phase 0 cannot run at all. No degraded path.

**Agent behaviour on reaching it.** Stop. Report the exact three variable names,
that the profile must be a dedicated one, and the Zotero version string it needs
confirmed.

---

### G-03 — Apply for the Semantic Scholar API key

> **Status 2026-10-14, later (owner): the key has arrived.** It is entered only through the preferences pane's
> key dialog (`P1-T44`) once the Semantic Scholar adapter (`P2-T05`) lands; it is recorded in no file. The
> owner pasted it once into the coordinator's chat, which the coordinator refused to use or store — that copy
> should be treated as exposed and the key **rotated** at Semantic Scholar before it is entered.
>
> *(Earlier the same day: applied for, not yet received.)* `P2-T05` builds the unauthenticated path as
> the default and leaves the keyed path's live test for the day the key arrives; the key then goes in through
> the runtime dialog only, never a file or a chat message. Until it arrives this gate stays open and `G-26`
> cannot start.

> **The record of this gate rests on one sentence and nothing else — flagged 2026-10-08 so it is not
> mistaken for a confirmed fact.** The status log below reads "Submitted" because **the owner reported on
> 2026-09-15 that the application had been submitted**. No agent submitted it and no agent could: this is a
> web form carrying a real identity. What the record does **not** have: the exact submission day (the log
> says so in as many words), any confirmation reference, and any reply. **23 days have passed** against a
> lead time this plan calls "the longest in the plan".
>
> **What to check, because the longest lead time in the plan should not rest on a memory.** Look for the
> application's own confirmation message in the maintainer mailbox, and record its date and reference here.
> If no confirmation exists, treat the application as **not submitted** and submit it — in which case the
> 23 days were never spent and the wait starts now, which is exactly the thing worth knowing early.
>
> **This blocks Phase 5 only**, and Phase 5 carries 10.5–15 days of float (`docs/11` §2), so nothing is
> stalled today. `P2-T05` ships the adapter with unauthenticated degradation, so Phase 2 does not wait
> either. *Updated 2026-11-05: that float is now ≈ 4.5–6 d (`docs/11` §2, re-priced by `plan/00` §6 item 344(b); ≈ 5–7 d before it, from items 335(g) and 336(d) of 2026-11-02; ≈ 4.5–6 d before the second of those, ≈ 3–4 d before the first; ≈ 17.75–25 d from
> 2026-10-26), since Phase 5's card sum, now 36.25–51 d, replaced its scaled 21–29 d. The gate itself closed
> on 2026-09-30; what still waits on the owner is the key's rotation, needed first by `P5-T31`, and its
> entry (`G-26`).*

**Blocks:** Phase 5 (`docs/11` §1 Phase 5; the `Source` adapter's keyed path in
Phase 2).

**What the human must do.** Submit the Semantic Scholar API key application under
their own identity, and record the submission date. `docs/11` R-3's mitigation
says to do this **in week 1 of Phase 0, before it is needed in Phase 5**, and
`docs/11` §4.3 V-14 makes "a key application submitted" part of the spike itself,
with its timebox written as "0.25 d + external wait".

**Why an agent cannot do it.** Account creation and an application submitted
under the user's real identity, with terms to accept (`docs/09` §5.3 records the
API License Agreement and the attribution obligation).

**Lead time.** **The longest in the plan.** `docs/11` R-3 rates the risk High
likelihood and states that "key issuance can take weeks". Approval time, not
code, is what gates Phase 5.

**Status, 2026-09-10.** **Not yet submitted.** `P0-T22`'s measurement half is done and
strengthens the case for submitting now: a second measurement 24 hours after `docs/02` §6.4's
returned **HTTP 429 on 12 of 12 requests over 72 seconds, with zero successes**. Unauthenticated
access is not "throttled", it is unusable, so the degraded Crossref + Europe PMC + lexical path
R-3 designs as a fallback is in fact the **default** path for every keyless user and must be
built and tested as such. Record the submission date here when the owner submits; the entry
below is what `P0-T28`'s spike report cites.

**Status, 2026-09-15.** **Submitted.** The owner reported on 2026-09-15 that the application has
been submitted and is awaiting a reply; the exact submission day was not given, so it is recorded
as *on or before 2026-09-15*. The multi-week approval clock is running. When the key arrives it
goes to `SecretId` `source.semanticscholar` in the OS keystore (D5), never to a preference, and
this gate closes by recording the arrival date here.

**Closed 2026-09-30.** The key arrived and the owner has it. Gate `G-03` is therefore satisfied:
the application was submitted on or before 2026-09-15 and answered within roughly two weeks — far
faster than `docs/11` R-3's "can take weeks", which is good news for Phase 5 but is one data point,
not a reason to weaken R-3's week-1 rule for anyone repeating this project.

The key itself is **not** in this repository, in `.env`, or in any preference (decision D5). For the
one remaining measurement that needs it — `P0-T21`'s Semantic Scholar leg —
`scripts/spike-abstract-coverage.ts` reads `SEMANTIC_SCHOLAR_API_KEY` from the **process
environment** only, and the run prints whether a key was sent, never its value. When the plugin
itself needs it, `G-26` in Phase 5 is where it goes into the OS keystore as `SecretId`
`source.semanticscholar`.

**What changed on 2026-09-09, and what did not.** `docs/11` §1's re-estimate
*cut* R-3's exposure: R-3 now records that on the corrected figures Phase 5
cannot start before ≈ 58.5–82 developer-days in — Phase 0 plus Phase 1 plus the
longer of Phases 2/3 — which is ≈ 3–4 months at 21 working days per month,
against ≈ 1.5–2 months on the old figures. The queue therefore has roughly twice
the calendar time to clear. R-3 attaches an explicit condition to that relief:
**provided the application is still submitted in week 1.** The start row above is
unchanged, and nothing here licenses deferring the submission — the extra months
are what make a week-1 submission likely to be *answered* before Phase 5 opens,
which is the entire point of opening this gate early.

**If it is not done.** Phase 5's primary candidate generator — the Recommendations
API (`docs/05` §3) — and its default embedding route, SPECTER2 (`docs/05` §5.1),
are both unavailable. **A degraded path exists and is designed in:** `docs/11`
R-3 requires relatedness to work with zero Semantic Scholar calls using Crossref
references, Europe PMC citations and lexical similarity, and `docs/10` §5
question 8's recommended default is to degrade gracefully rather than require a
key. `docs/11` §1 Phase 5's DoD already contains the no-key clause. The cost of
not doing this gate is therefore reduced quality, not a missing feature — but
only if the fallback was built, which is exactly why the gate must be opened
early enough to know.

**Agent behaviour on reaching it.** Stop. Report: that V-14's external-wait half
is unstarted, the date it was requested to start, and that every Phase 5 task
card touching `docs/05` §3 or §5.2 is blocked on an approval the plan cannot
accelerate. Do not scrape, do not share a key from elsewhere, and do not raise
the unauthenticated request rate to compensate (`docs/09` §5.3 sets 1/s in either
mode).

---

### G-04 — Register the NCBI `tool`/`email` pair and obtain the optional key

> **IN MOTION 2026-10-08.** The owner chose to start the registration now rather than defer it to the
> release, on the ground that the external turnaround is the part nobody controls. The coordinator
> supplied the steps; the submission itself is the owner's, because it is made under a real identity and
> commits the project to a usage policy. **The optional key is a separate thing and is deliberately not
> being obtained yet**, because no surface exists to enter one and `docs/09` forbids a key in any file,
> preference or log — so a key obtained today would have nowhere safe to live. Revisit the key when the
> preference pane lands (`plan/00` §6 item 5).
>
> ### The steps, 2026-10-08
>
> **1. Register exactly these two values, character for character.** They are what the build sends, read
> from the source rather than from prose:
>
> | parameter | value | where it is defined |
> |---|---|---|
> | `tool` | `research_helper` | `src/core/http/userAgent.ts:34` (`TOOL_NAME`) |
> | `email` | `suppakoko@gmail.com` | `src/core/http/userAgent.ts:28` (`MAINTAINER_EMAIL`) |
>
> **A registration that does not match these exactly does not cover what the program sends.** Decision
> D10 fixes the address as the **maintainer's**, never the end user's, and `src/core/http/client.ts:934`
> refuses a request to NCBI carrying any other address — so these two values are the only ones that can
> ever appear, and changing either one means registering again.
>
> **2. Why it is not enough to send them.** NCBI's own wording, quoted in `docs/09` §5.1 from its General
> Introduction to the E-utilities (NBK25497): *"merely providing values for tool and email in requests is
> not sufficient to comply with this policy; these values must be registered with NCBI"*, and the same
> page states that unregistered addresses violating the usage policy may be blocked.
>
> **3. Where to submit it — read this from NCBI's own page, not from here.** The corpus records the
> **obligation** and does not record the **route**, and the coordinator **could not read NCBI's page to
> find out**: on 2026-10-08 `https://www.ncbi.nlm.nih.gov/books/NBK25497/` served a bot-verification
> check instead of the document, and working around such a check is forbidden. **So this step is the
> owner's, in the owner's own browser**, on that page's usage-guidelines section. Expect one of two
> shapes: a setting inside the NCBI account, or a message to the E-utilities contact address that page
> names. **Do not guess between them** — whichever the page says today is the one that counts.
>
> **4. Record the outcome back here** when it is done: the date, the two values as submitted, and where
> any confirmation is kept. The release checklist reads this gate (`docs/13` §8.9), so an unrecorded
> registration is the same as none.
>
> **5. Do not obtain the optional key yet, and do not paste a key anywhere.** No surface exists to enter
> one, `docs/09` forbids a key in any file, preference or log, and a key pasted into a conversation is
> not accepted or used. The key raises the request rate from 3 per second to 10; the build already runs
> under the keyless limit, so nothing is waiting on it.

**Blocks:** Phase 1's politeness posture; **the v1.0 release** (`docs/13` §8.9
carries it as a release-hygiene checkbox).

**What the human must do.** Register the `tool` and `email` values with NCBI
under decision D10's maintainer address, and separately obtain an optional NCBI
API key from the NCBI account settings if the higher rate is wanted.
`docs/09` §5.1 quotes NCBI's own wording that "merely providing values for tool
and email in requests is not sufficient to comply with this policy; these values
must be registered with NCBI", and states plainly that **registering is a release
task, not a code task**.

**Why an agent cannot do it.** Account creation, a registration submitted under
the maintainer's real identity, and a policy commitment that binds the project.

**Lead time.** Unknown; treat as days to weeks. Start in week 1 because it is a
release blocker with an external party.

**If it is not done.** The plugin still sends `tool` and `email` on every request
(`docs/09` §5.1 says so regardless), so Phase 1 functions — but the project is
out of compliance, `docs/13` §8.9's checkbox fails, and `docs/09` §5.1 notes that
unregistered IPs violating the usage policy may be blocked. **No degraded path
for the release**; a compliant release requires this.

**Agent behaviour on reaching it.** Stop at the release checklist item. Report the
exact `tool` and `email` values decided by D10, that registration is separate from
sending them, and that `docs/13` §8.9 blocks the release until it is on file.

---

### G-05 — Create provider accounts and obtain LLM and TTS keys

**Blocks:** V-7, V-10, all of Phase 3, and by inheritance Phases 4, 5 and 6.

**What the human must do.** Create accounts and obtain keys for the four providers
`docs/11` §1 Phase 3 names — OpenRouter (the D6 default), OpenAI, Google Gemini,
Anthropic — accepting each provider's terms. Gemini additionally requires
deciding whether the key's project is billing-linked, which `docs/09` §3.3 calls
"the detail everyone misses": paid status attaches to the *project*, not the
account. Set provider-side spend caps, which `docs/11` R-9's mitigation calls the
real backstop.

**Why an agent cannot do it.** Account creation, terms acceptance, and payment
instrument entry — all prohibited actions for an agent regardless of who asks.

**Lead time.** Hours for account creation; linking billing to a Google Cloud
project may take longer.

**If it is not done.** V-7 (the entire no-backend premise) cannot be verified, and
`docs/11` §4's closing note says that if V-7 fails, stop and re-plan before Phase
1. **A partial degraded path:** V-7 can be run against whichever providers do have
keys, with the remainder marked blocked in the spike report — but Phase 3's DoD
requires all four adapters producing a summary through the same code path.

**Agent behaviour on reaching it.** Stop. Report which provider is missing a key,
which spike or task is blocked, and that no key may be pasted into a file, a
preference, a test fixture, or a commit (`plan/README.md` §5 rule 5, D5,
`docs/09` §7's `[BLOCKER]` items).

---

### G-06 — Acknowledge the Gemini free-tier data-training terms

**Blocks:** every Gemini call, starting with V-10 in Phase 0; Phase 6 entirely.

**What the human must do.** Read and explicitly acknowledge what `docs/09` §3.3
documents from Google's own terms: on unpaid services Google uses submitted
content and generated responses to improve its products, and human reviewers may
read, annotate and process API input and output, with Google's explicit
instruction not to submit sensitive, confidential or personal information. Then
decide, per key, whether that key's project is billing-linked, and accept the
consequence `docs/09` §3.3 spells out — **a free-tier user who generates an audio
report has sent their trend report to Google for product improvement.**

**Why an agent cannot do it.** It is consent to a data-use policy with real
consequences for the human's own unpublished material. `docs/09` §3.4 rule 4
requires the plugin to *assume free tier* when it cannot determine otherwise, and
marks `> **Unverified:**` whether a programmatic billing signal exists at all —
so there is no automated substitute for asking.

**Lead time.** Minutes, but it must precede the first Gemini call, including the
V-10 Korean sample.

**If it is not done.** V-10 cannot run, so R-8 stays unretired and Phase 6 cannot
be committed to. **Degraded path:** none for Gemini; `docs/09` §3.5 refuses the
Gemini free tier outright in strict privacy mode, and `docs/04` §7.5's rank-2
fallback (OpenAI TTS) needs its own key and carries an `Unverified` price.

**Agent behaviour on reaching it.** Stop before issuing any Gemini request.
Report the specific paragraphs in `docs/09` §3.3, whether the key's tier is known
or unknown, and that an unknown tier is treated as free.

---

### G-07 — Approve the first paid API call and the Phase 0 spike spend

**Blocks:** V-7 (four providers), V-10 (Gemini TTS), and any later spend.

**What the human must do.** Approve, explicitly, that real money may be spent
against their keys for the Phase 0 spikes, and state a ceiling for that spend.
`plan/README.md` §6 already requires any money-spending task to carry a human
gate and state the expected spend.

**Why an agent cannot do it.** It commits the user's funds. This gate recurs:
every later increase to a spend ceiling is G-20, and the first production job is
G-21.

**Lead time.** Minutes.

**If it is not done.** V-7 and V-10 cannot run; per `docs/11` §4, a V-7 or V-10
failure means stop and re-plan. No degraded path — these are live-call spikes by
construction.

**Agent behaviour on reaching it.** Stop. Report the provider, the endpoint, the
estimated token count and the estimated USD figure before the call, never after.

---

### G-08 — Install the XPI by hand and run the teardown cycles

**Blocks:** V-1, V-4, Phase 0's definition of done, and `docs/13` §8.1 at every
later release.

**What the human must do.** Drag the built XPI onto Tools → Plugins on the dev
profile, confirm it installs cleanly, then disable and re-enable it five times
while watching the debug output, confirming no zombie menu item, observer or
timer survives (FR-56; `docs/11` §4.1 V-4).

**Why an agent cannot do it.** Drag-and-drop into a desktop GUI, plus a visual
judgement about what the plugins window and debug log show. `docs/11` R-11 also
notes that the scaffold's headless support is documented for Ubuntu only, so
local Windows in-Zotero runs are headed and manual by design.

**Lead time.** Minutes per cycle.

**If it is not done.** R-12 (incomplete teardown) stays unretired, and `docs/11`
§1 Phase 0's DoD fails. **Partial degraded path:** the scaffold's in-Zotero test
runner may automate part of this on Ubuntu in CI (V-5), but the Windows install
path — the one the owner actually uses — stays manual.

**Agent behaviour on reaching it.** Stop. Report the XPI path, the exact
disable/enable sequence to perform, and what to look for in the debug log.

---

### G-09 — Provide macOS and Linux machines, including one without libsecret

**Blocks:** V-16's non-Windows half, V-5's CI story, Phase 7's three-OS QA
(`docs/13` §8), and the Phase 3 prefs design via G-10.

**What the human must do.** Arrange access to a macOS machine and a Linux
machine, and specifically to a Linux environment **without libsecret**, which is
the case `docs/11` §4.3 V-16 asks to measure and which D5's open note and
`docs/09` §8 items 1 and 2 turn into a shipped-behaviour decision.

**Why an agent cannot do it.** Hardware and OS-account provisioning; and on
macOS, Keychain prompts are GUI dialogs authenticated as the user.

**Lead time.** Days to weeks if hardware must be arranged. Start in week 1.

**If it is not done.** V-16 is Windows-only, so the keystore design is unproven
on two of three platforms, and G-10's decision has no measurement behind it.
**Degraded path:** ship Windows-tested behaviour and mark macOS/Linux as untested
in the release checklist — which `docs/13` §8 does not permit for a minor or major
release, since it requires all three OSes.

**Agent behaviour on reaching it.** Stop. Report which OS is missing, which spike
or checklist item is blocked, and that a Windows-only V-16 result cannot close
`docs/09` §8 items 1 and 2.

**Status, 2026-09-30 — now the binding constraint, and the measurement that lifts it is small.**
Phase 0 ended without this gate being satisfied: every Phase 0 measurement is Windows. `V-16`'s
degraded branch was exercised only against a deliberately throwing `encrypt()`, which proves the
code path handles a throw but says nothing about whether a real Linux Zotero throws at all. The
owner decided on 2026-09-30 to **measure before deciding `G-10`**, which makes this gate a
prerequisite of `P3-T03` rather than a Phase 0 leftover.

**The measurement is deliberately narrow, so it cannot become a hardware project.** One Linux VM is
enough, and the probe already exists — `P0-T23`'s keystore round-trip. What is needed:

1. A minimal Debian or Ubuntu install with **no `gnome-keyring` and no `libsecret`**: run the probe
   and record whether `Zotero.OSKeyStore.encrypt()` throws, and the exact error if it does.
2. The **same probe on a stock GNOME or KDE desktop**, where libsecret is present by default. This
   is the half that actually bounds the decision: if it succeeds there, the affected population is
   minimal and headless installs, not Linux users, and `G-10` is a much smaller trade than
   `docs/09` §8 item 1's sentence implies.
3. macOS remains owed for Phase 7's three-OS QA (`docs/13` §8) but is **not** on `G-10`'s path:
   macOS has a Keychain, so the degraded tier is not reachable there either.

Steps 1 and 2 are a VM and an existing probe. They are not gated on acquiring real hardware, which
is the reason this gate sat open for three weeks.

**Update, 2026-09-30 — most of what this gate was for has been answered from primary sources, and
the answer is not the one the plan assumed.** No Linux machine was used; Zotero 10's own
`modules/OSKeyStore.sys.mjs` was extracted from this machine's `omni.ja`, and
`security/manager/ssl/OSKeyStore.cpp` was read on **mozilla-esr140**, the Gecko branch Zotero 10
ships (140.15.0, measured `P0-T23`). Two findings:

1. **Gecko does not fail when libsecret is missing — it substitutes `NSSKeyStore`**, which keeps the
   key in the profile's NSS database as a persistent `CKM_AES_GCM` token key with no password of its
   own. `encrypt()` therefore **succeeds** on a libsecret-less Linux, so the throw `G-10` was
   written to branch on never arrives. Recorded with the quoted source in `docs/09` §1.7.
2. **`canReauth()` returns `false` on Linux** ("We have no support on linux (bug 1527745)", in the
   shipped module). It gates only the string-valued `reauth` path and `encrypt()` passes boolean
   `false`, so encryption is unaffected — but no OS re-authentication can gate a key reveal on
   Linux, which `docs/09` §1.9 item 1 should not assume.

**What remains for this gate is now small and specific**, and it is confirmation rather than
discovery. Three things, in order of how much rests on them:

1. **Can a plugin tell which backend is live?** This is the one that matters, because the `G-10`
   decision of 2026-09-30 — route NSS-backed storage into the degraded dialog — is **unimplementable
   without it**. `nsIOSKeyStore` exposes no backend name and `encrypt()` succeeds either way, so the
   candidate is `js-ctypes`: attempt to `dlopen` libsecret from the plugin and infer the backend the
   same way `MaybeLoadLibSecret()` does. Answer this before `P3-T02` is started.
2. **Does `MaybeLoadLibSecret()` actually fail on a minimal install?** Run the `P0-T23` probe on a
   Debian or Ubuntu install with no `gnome-keyring` and no `libsecret`, and again on a stock
   GNOME/KDE desktop. The second run bounds the affected population.
3. **What does the live backend report**, if anything, so §1.9 item 3's badge can name it rather
   than guessing.

**Nothing established so far was observed running** — it is read from the ESR 140 source and from
the shipped JS module, and the gate stays open until it is run.

---

### G-10 — Decide the Linux-without-libsecret fallback tier

> **DECIDED 2026-10-08 — tier 2, session-only.** When the operating-system keystore probe fails, keys are
> re-entered each launch and are **written nowhere**. The owner took the safest option knowing the cost:
> **work that runs on its own in the background stops** on such a machine until someone enters the keys
> again.
>
> **The second half of this gate follows from the first, and the inference is stated rather than assumed:**
> `docs/09` §8 item 2 asked whether the passphrase-encrypted-file tier ships in v1 at all. With tier 2
> chosen as the offered fallback, **tier 3 has no caller, so it does not ship in v1** — one word from the
> owner reverses that. This is consistent with decision D5, which already refuses a plaintext tier.
>
> **What is still owed, and it is less than before.** `G-09` still asks for a machine without a keystore,
> because what must be verified is that the probe **fails cleanly and says so** rather than appearing to
> succeed — `P0-T28`'s own escalation was that the degraded tier has no measurement behind it, only a
> deliberately throwing encrypt call on Windows. Choosing tier 2 shrinks the work to be verified; it does
> not remove the measurement.

**Blocks:** Phase 3's prefs design (`docs/11` §5 lists this explicitly as the
Before-Phase-0-ends decision that remains open under D5).

**What the human must do.** Choose, from `docs/09` §1.7's ladder, which fallback
is offered first when the OS keystore probe fails: **tier 2 session-only** (keys
re-entered each launch, unattended background jobs stop working) or **tier 3
passphrase-encrypted file**. Separately decide `docs/09` §8 item 2 — whether the
passphrase tier ships in v1 at all, given it is real work for a small population.
Tier 4, plaintext preferences, is not a choice: D5 and `docs/09` §1.7 both
declare it not implemented and not to be added.

**Why an agent cannot do it.** It is a security-posture judgement with a stated
user cost — `docs/09` §8 item 1 says in terms that it "means some Linux users
cannot run unattended background jobs". That trade is the product owner's.

**Lead time.** Product-owner turnaround, informed by V-16's measurement (G-09).

**If it is not done.** Phase 3's `SecretStore` cannot be specified beyond tier 1,
and the prefs pane's backend badge (`docs/09` §1.9 item 3) has no degraded state
to render. **Degraded path:** ship tier 1 only and refuse LLM features where the
keystore is unavailable — which `docs/09` §1.7's tier-4 paragraph already
describes as the honest terminal behaviour, but which is a narrower product than
D5 anticipates.

**Agent behaviour on reaching it.** Stop. Report V-16's measured behaviour on the
libsecret-less box, the two options with the consequence sentence from
`docs/09` §8 item 1, and that the answer must be written into `docs/09` §1.7 and
the open note under D5 in `docs/00` §3.

**Status, 2026-09-30 — deferred to before `P3-T03`, by the owner's decision, and correctly so.**
The owner chose to **measure first** rather than pick a tier now. That is what this gate's own
"Lead time" line already prescribed — "informed by `V-16`'s measurement (`G-09`)" — and Phase 0
ended with that measurement never taken, so a decision made now would rest on nothing. `G-09`
above now carries the narrow version of the measurement.

**Two corrections to how this gate has been characterised, including by me.** First, the decision is
**not** whether to build tier 3. `P3-T03` ("Tier ladder — session-only and passphrase, no tier 4",
0.75 d) already builds **both** tiers 2 and 3 and already shows `secretBackendDialog` offering both
on a failed probe. Tier 3 is budgeted. What this gate actually settles is narrower: **which tier the
dialog offers first**, and `docs/09` §8 item 2 — whether the passphrase tier ships in v1 at all.
Dropping tier 3 would *reduce* committed scope, not avoid new work. Second, the cost sentence in
`docs/09` §8 item 1 — that "some Linux users cannot run unattended background jobs" — is
**unquantified**. Step 2 of `G-09`'s measurement is what turns it into a number.

*Corrected 2026-10-22 (`plan/00` §6 item 268, recorded from `P3-T03`):* the paragraph above
describes the card as it was written on 2026-09-30, not what was built. After this gate was
decided on 2026-10-08 (tier 2 only), `P3-T03` built **tier 2 alone**. Its degradation dialog offers
session-only storage or no stored keys. No passphrase tier exists, and `secretBackend` has no
`passphrase` value (`docs/07` §8.5, corrected 2026-10-21 under `plan/00` §6 item 267).

**What ships regardless, and needs no decision.** Tier 1 is measured and is the default. Tier 4,
plaintext preferences, stays not implemented; D5 and `docs/09` §1.7 both refuse it, and this
deferral does not reopen it. Nothing in Phase 1 or Phase 2 depends on this gate.

**No new task card was created for the deferral.** The implementation is `P3-T03`'s and the
measurement is this gate pair's; adding a card for a decision would have moved the plan's effort
figures for a third time on one day without adding any work that was not already carded.

**The question changed on 2026-09-30, before anyone answered the old one.** `G-09`'s update above
establishes from the ESR 140 source that **`encrypt()` does not throw on a libsecret-less Linux**:
Gecko falls back to `NSSKeyStore` and stores the key in the profile's NSS database. So the branch
this gate was created to choose a fallback for is close to unreachable, and a startup probe that
only catches a throw will report tier 1 and never show the dialog `P3-T03` builds.

**What the owner now has to decide is a different and sharper thing: is NSS-backed storage
acceptable as tier 1?** In that mode the key sits inside the Zotero profile, protected only by a
primary password if one is set — so it **travels with a profile copy or backup**, which is precisely
what `docs/09` §1.8's verbatim residual-risk text promised it would not do. That text has been
corrected to be conditional on the live backend, §1.9 item 3 has gained a fourth, warning-coloured
badge state, and §1.9 item 8's empty-key explanation is now conditional too. **The badge is
therefore load-bearing rather than informational: §1.8's statement is only true if the badge is
accurate.** The three options in front of the owner are to accept NSS-backed tier 1 with that badge
and that text, to treat NSS-backed storage as a degraded tier and route it into `P3-T03`'s dialog
alongside tiers 2 and 3, or to refuse it and require a real keyring on Linux.

**This does not block Phase 1 or Phase 2.** It does mean `P3-T02`'s startup probe cannot be written
as "catch the throw" — it has to interrogate which backend is live, which is a design input Phase 3
now has in writing rather than discovering at implementation time.

**DECIDED 2026-09-30 by the product owner: NSS-backed storage is a degraded tier, not tier 1.**
When the key is in the profile's NSS database it is routed into `P3-T03`'s degradation dialog
alongside session-only and passphrase storage, and it is **not** presented as protected by a system
keyring. The reasoning is this document's own: `docs/09` §1.7 refuses tier 4 because "implementing it
as a fallback guarantees it becomes the common case", and a key sitting in the profile — travelling
with any copy or backup of the Zotero folder, protected only by a primary password if one is set —
is nearer tier 4's problem than tier 1's guarantee.

**This decision has a feasibility precondition, and it is not yet met.** Routing NSS-backed storage
into the degraded dialog requires knowing *which* backend is live, and **nothing in the JS API
reports it**: `nsIOSKeyStore` exposes no backend name, and `encrypt()` succeeds either way. So the
decision is conditional on a detection mechanism existing. The candidate is `js-ctypes` — attempt to
`dlopen` libsecret from the plugin and infer the backend from whether that succeeds, mirroring what
`MaybeLoadLibSecret()` does in Gecko. **`G-09`'s remaining scope is extended to answer exactly
this** rather than a new card being created, because `G-09` already owed "find out what the live
backend reports" and this is that same question sharpened.

**If detection proves infeasible, this decision must be revisited, and that is recorded now rather
than discovered in Phase 3.** Without detection the only implementable choices are the two the owner
did not pick: accept NSS-backed storage as tier 1 with a badge that can only say "system keyring or
Zotero's database", or refuse Linux without a keyring outright. `P3-T02` must not be started on the
assumption that detection works.

---

### G-11 — Judge the V-10 Korean TTS sample (native speaker)

**Blocks:** V-10, R-8, and the commitment to Phase 6.

**What the human must do.** Have a native Korean speaker listen to the 200-word
Korean sample containing embedded English technical terms and judge its quality,
per `docs/11` §4.2 V-10.

**Why an agent cannot do it.** It is a language and prosody judgement in a
language whose acceptability an agent cannot certify — and the stakes are stated:
`docs/11` R-8 says that if Korean quality is poor, "Feature 5's headline value
evaporates and the provider decision changes".

**Lead time.** Scheduling a person; start looking in week 1.

**If it is not done.** V-10 has no answer, so R-8 is unretired and Phase 6 is
committed to blind. **Degraded path:** none that preserves the feature's premise;
`docs/11` §4's closing note says a V-10 failure means stop and re-plan.

**Agent behaviour on reaching it.** Stop. Report the generated sample's file
path, the script text, and the specific question to ask (naturalness, and the
pronunciation of the embedded English terms).

---

### G-12 — Assemble the 40-PDF IMRaD fixture set

**Blocks:** Phase 3's ship gate (`docs/11` §1 Phase 3 requires detector validation
against the fixture set *before this phase ships*), R-19b, and Phase 4's digest
design.

**What the human must do.** Collect 40 PDFs spanning the layouts `docs/06` §4.3
names — Elsevier, Springer, Wiley, OUP, PLOS, Nature, IEEE and arXiv-LaTeX — plus
`docs/11` §4.2 V-8b's five-PDF spike set covering single-column publisher,
two-column publisher, arXiv preprint, bioRxiv preprint and scanned. Then label
section boundaries so accuracy can be measured against `docs/06` §4.3's ≥ 85 %
target.

**Why an agent cannot do it.** The publisher PDFs come from the human's own
subscribed access. `docs/09` §5.7 forbids publisher-website scraping, paywall
circumvention and institutional-credential replay outright, and `docs/09` §4.4
covers the licensing question. An agent may process PDFs the human supplies; it
may not obtain them.

**Lead time.** Days of the human's own time; start in Phase 0 so the set exists
before Phase 3 needs it.

**If it is not done.** R-19b cannot be closed by measurement. `docs/11` R-19b's
rule then applies by default: `auto` degrades to whole-document chunking and the
summary prompt must not claim section provenance — which is the safe outcome, but
it is a capability loss taken by omission rather than by decision.

**Agent behaviour on reaching it.** Stop. Report the layout coverage still
missing, that redistribution of the PDFs is out of scope (they stay local), and
that without the set the R-19b decision at G-22 has no evidence behind it.

---

### G-40 — Approve the two throwaway public releases of the V-18 update dry run

*Added 2026-09-09. Gate IDs are permanent and never reused, so this Phase 0 gate
takes the next free number rather than renumbering §3–§10.*

**Blocks:** `V-18` and, through it, R-15's retirement in Phase 0.

**What the human must do.** Give explicit permission to publish **two** releases —
`v0.0.1` and `v0.0.2` — to the public repository created at G-01, and confirm
those version numbers are acceptable as throwaway pre-1.0 tags. `docs/11` §4.3
`V-18` is the spike: build v0.0.1, install it, publish v0.0.2 with a generated
`update.json` at the `update_url`, and observe Zotero offering the update.

**Why an agent cannot do it.** It publishes software under the user's identity to
a public audience, months before v1.0 — the same class of action as G-35, and the
same `docs/09` §6.3 restriction on who may push tags and publish releases. Two
public artefacts carrying the D9 plugin ID exist afterwards and cannot be quietly
unpublished from the update path of anyone who installed them.

**Lead time.** Minutes, once G-01 has produced the repository.

**If it is not done.** `V-18` cannot be answered, so R-15 stays unretired and the
release path is first exercised in Phase 7 with a real v1.0 — against `docs/11`
§4.3's reason for scheduling it now, "cheapest to verify while nothing depends on
it". **Degraded path:** run the same dry run against a private repository, which
exercises `build.makeUpdateJson` and the hash but not the public `update_url`
fetch Zotero actually performs.

**Agent behaviour on reaching it.** Stop before creating a tag or triggering the
release workflow. Report the two version numbers, that the releases are
deliberately throwaway, and that `P0-T27` cannot proceed past its step 2 without
this approval.

---

## 3. Phase 1 gates

### G-41 — Review the Phase 1 `ko-KR` UI bundle (`KO_PENDING_REVIEW.length`, 82 as of 2026-10-08)

> *Re-counted 2026-11-02 (`plan/00` §6 items 333, 334): `P4-T20`'s 25, `P5-T15`'s 12 and `P4-T21`'s 2 left `KO_PENDING_REVIEW` that day. What it still holds is what cards in progress add; `src/i18n/keys.ts` is the count.*
>
> *Measured 2026-11-02 in Zotero 10.0.3, in five runs, after `plan/00` §6 item 335(l): `[P1-T18] ko-KR totals: 353 present, 1 absent; expected 353 / 1`. It read 350 / 4 before that item moved its three strings. So `KO_PENDING_REVIEW` is empty, and the 1 absent is `P0-T24`'s deliberate fallback fixture. The two report labels of that item are not Fluent ids and are not in this count; `KO_REPORT_LABELS_PENDING_REVIEW` is empty too. The figures of 2026-10-08 in this section's heading and in the summary table's row are that date's snapshot.*

> *Measured 2026-11-06 in Zotero 10.0.3, after the owner's review of the batch of 116 in chat (`plan/00` §6 item 357): `[P1-T18] ko-KR totals: 469 present, 1 absent; expected 469 / 1`. All 116 went in byte for byte from `plan/reports/ko-review-336.ftl`, 5 into `research-helper-mainWindow.ftl` and 111 into `research-helper-searchDialog.ftl`, and left `KO_PENDING_REVIEW` for `KO_PRESENT`, so `KO_PENDING_REVIEW` is empty again. The 1 absent is `P0-T24`'s deliberate fallback fixture. The two `-target-default` ids carry the English value by the owner's choice (item 357(a)) and count as present. Three consecutive full integration runs on that tree the same day, with `OPENROUTER_API_KEY` removed from the environment: 350 passed and 2 pending each time, the same totals line each time, and the live-request guard reported 1210 channels read, none cancelled and none away from loopback.*
>
> *Measured 2026-11-06 in Zotero 10.0.3, in three runs (integration round on `P5-T26`, `P5-T27`, `P5-T28`): `[P1-T18] ko-KR totals: 353 present, 117 absent; expected 353 / 117`. The round added no string; the 69 added absent ids since the 48 above are `P5-T26`'s 38 and `P5-T27`'s 31 commented stubs, so `P5-T26`'s forecast of 86 was before `P5-T27` counted. `G-41`'s owner review of them is separate.*
>
> *Measured 2026-11-05 in Zotero 10.0.3 (integration round on `P5-T16`, `P5-T17`, `P5-T24`, `P5-T25`, `P5-T32`): `[P1-T18] ko-KR totals: 353 present, 48 absent; expected 353 / 48`. The round added no string; the 44 added absent ids are those cards' commented stubs on `KO_PENDING_REVIEW`.*
>
> *Measured 2026-11-05 in Zotero 10.0.3 (integration round on `P5-T11`, `P5-T14`): `[P1-T18] ko-KR totals: 353 present, 4 absent; expected 353 / 4`. The 3 added absent ids are `rh-error-seed-gone`, `rh-error-seed-no-identifier` and `rh-error-seed-no-match`, on `KO_PENDING_REVIEW` and resolving from English along the `ko-KR`, `en-US` chain; the fourth is the same deliberate fallback fixture.*

> **DEFERRED 2026-10-08, by the owner, to before the v1.0 release.** English only until then. Measured
> the same day, by counting the lists in `src/i18n/keys.ts` rather than reading the figure off this
> document: `KO_PENDING_REVIEW` is **82**, `KO_PRESENT` 4, `KO_DELIBERATELY_ABSENT` 1, over **87**
> surface ids. **Re-counted by script on 2026-10-08, after `P1-T45` added three**, which is what moved 79
> to 82 and 84 to 87; the three lists still partition the 87 declared ids exactly.
>
> **What deferral costs, stated so the decision stays visible.** The Korean half of the product does not
> work until this is done: an id with no Korean entry falls back to English, so a Korean-locale user sees
> a mixed screen rather than a broken one. **This gate therefore moves from blocking Phase 1 to blocking
> the release**, and `docs/13`'s release checklist is where it must be caught. Phase 1's UI cards are
> already approved and are not reopened by this.

**Blocks:** `P1-T18`'s human gate, and the Korean half of every Phase 1 UI card
(`P1-T20`, `P1-T21`, `P1-T22`).

**Created 2026-09-30, because it did not exist.** `P1-T18`'s `Notes` say "human gate details go in
`06-human-gates.md`" and `plan/00-task-index.md` counts `P1-T18` among the 21 gated cards — but
`grep T18 plan/06-human-gates.md` returned **nothing**. The nearest gate, `G-31`, is for **prompt**
review and its `Blocks:` line is *the release*, so as the plan stood a Phase 1 card was either
blocked on a Phase 7 gate or had no gate at all.

**What the human must do.** Translate every id on `KO_PENDING_REVIEW` in `src/i18n/keys.ts` — **82
strings as of 2026-10-08** — each written into the matching `ko-KR` file as a commented stub carrying
its English source, in the order a reviewer meets them, so the workflow is "uncomment and translate
in place". The split, by which surface list each pending id belongs to: **21 in
`research-helper-mainWindow.ftl`** (1 menu id, 1 provenance note title, 2 import-outcome strings, 1
progress headline, and the 16 `rh-error-*` ids of `ERROR_MESSAGE_IDS`); **58 — the entire Search &
Import window — in `research-helper-searchDialog.ftl`**, of which 16 are the state and status strings
that `keys.ts` groups under `docs/08` §8.4's five states and §4.6's per-database status list.

> **Every figure in this gate is a derivation with a dated snapshot, not a literal — corrected
> 2026-10-05 (`P1-T34`), because the literals had already gone stale once and a human sizes this gate
> by them.** The rules, each a one-line read of `src/i18n/keys.ts`, which is the single source:
>
> - **Strings a human must translate** = `KO_PENDING_REVIEW.length`.
> - **Ids declared for Phase 1 in total** = `MAIN_WINDOW_MESSAGE_IDS.length + SEARCH_DIALOG_MESSAGE_IDS.length`.
> - **Already translated or exempt** = `KO_PRESENT.length`; **deliberately left missing** (`P0-T24`'s
>   fallback fixture) = `KO_DELIBERATELY_ABSENT.length`. These three lists partition the declared ids,
>   which is why `KO_PENDING_REVIEW.length + KO_PRESENT.length + KO_DELIBERATELY_ABSENT.length` equals
>   the declared total.
> - **The per-surface split** = how many of `KO_PENDING_REVIEW` appear in each of the two surface
>   lists.
> - **The `rh-error-*` share** = `ERROR_MESSAGE_IDS.length`.
>
> **Snapshot re-read 2026-10-08 by the coordinator**, by script from `src/i18n/keys.ts` rather than from
> this document: mainWindow 25 + searchDialog 62 = **87 declared**; `KO_PENDING_REVIEW` **82**,
> `KO_PRESENT` **4**, `KO_DELIBERATELY_ABSENT` **1** (82 + 4 + 1 = 87); pending split **21 / 61**.
> `P1-T45` added the three that moved them on 2026-10-08. **The earlier snapshot of 2026-10-05 read
> 25 + 59 = 84, pending 79, split 21 / 58.** The integration run prints the live numbers itself, as
> `[P1-T18] declared ids: mainWindow 25, searchDialog 62, total 87` and
> `[P1-T18] ko-KR totals: 4 present, 83 absent; expected 4 / 83` in
> `test/integration/l10n.spec.ts` — its "absent" is the **83** of
> `KO_PENDING_REVIEW.length + KO_DELIBERATELY_ABSENT.length`, i.e. the 82 a human must write plus the
> one hole that must stay open, which is why that line reads one higher than this gate's headline. The
> run asserts the gap is *exactly* those two lists, so that run, not this paragraph, is the thing to
> believe if the two ever disagree. Both lines above were read from the run of 2026-10-05.
>
> **Why this note exists.** The gate was written on 2026-09-30 reading 79 / 84. `P1-T32` then added an
> id (80 / 85) and `P1-T33` retired one (back to 79 / 84), and in between the literals here were
> simply wrong, with nothing in the text to say how to recompute them. The numbers above are
> therefore timestamped and the rule that produces them is written down; **if a later card adds or
> retires an id, re-read the rules, do not add one to the snapshot.** One earlier sub-figure is *not*
> reproduced above: this paragraph said "23 state and status strings", and no list in `keys.ts` yields
> 23 — the file's own state/status grouping is the 16 named above. The 23 may have counted a wider set
> under a definition that was never recorded; it is reported rather than reconstructed.

**Three of the 79 are owner *decisions*, not translations, and a translator cannot answer them.**
(1) `research-helper-provenance-note-title` — `FR-8` fixes the title literally as
`Research Helper — search provenance <ISO timestamp>`. Should a Korean UI write a Korean note title
at all, or keep the English so notes in one library stay greppable? **If a test ever asserts the
literal English title, a Korean UI breaks it.** (2) `research-helper-progress-headline` — the
product name; `docs/08` §10.2 renders it `리서치 헬퍼` in menus, so it probably follows, but it is the
same decision. (3) `research-helper-menu-collection-search-import` — both the id and the English
wording were created by `P1-T18` because `docs/08` §2.4/§2.5 have no collection-context entry for
Phase 1; rule on the wording before translating it.

> **Decision (2) now names a retired id — flagged, deliberately not rewritten, 2026-10-05 (`P1-T34`).**
> `P1-T33` retired `research-helper-import-toast-header` on 2026-10-05, having decided that `docs/08`
> §4.4's completion toast and `docs/07` §7.7's per-job popup are **one surface, not two**, and that
> the one surviving headline id is `research-helper-progress-headline` (`src/i18n/keys.ts`'s
> `L10N_PROGRESS_HEADLINE`, where that decision is recorded; its `KO_PENDING_REVIEW` comment says
> "`G-41` now has one product-name decision here instead of two identical ones"). So the *decision* is
> unchanged and still owed — whether a Korean UI writes the product name in Korean — while the id it
> is attached to has moved. **There are still three owner decisions and they are still all on
> `KO_PENDING_REVIEW`**; only the id in (2) is wrong. `P1-T34` re-derives this gate's **counts** and may
> not alter its decisions, so re-pointing (2) at `research-helper-progress-headline` is left to the
> gate's owner rather than done here.
>
> **Re-pointed by the gate owner, 2026-10-06.** (2) now names `research-helper-progress-headline`.
> The decision itself is untouched — whether a Korean UI writes the product name in Korean — and
> there are still three owner decisions, all still on `KO_PENDING_REVIEW`. **What changed is one id,
> and the count did not move**, which is why re-deriving this gate's counts (`P1-T34`) and
> re-pointing this decision (here) were correctly kept as separate acts by separate hands.

**Why an agent cannot do it.** Machine translation is forbidden for shipped UI strings: a
plausible-looking wrong translation is worse than a visible gap, and the gap is already harmless —
the measured per-message `ko-KR → en-US` fallback renders English for anything untranslated, with
every declared id — `MAIN_WINDOW_MESSAGE_IDS.length + SEARCH_DIALOG_MESSAGE_IDS.length`, **84 as of
2026-10-05** — resolving under a live Korean UI.

**Lead time.** Hours of a native speaker's time. **`G-11` (line up a Korean speaker, Phase 0 week 1)
is the scheduling prerequisite and is still open.**

**If it is not done.** Phase 1 ships with an English-only search window for Korean users. Not a
blocker for `P1-T23`'s definition-of-done run, which is functional; it is a blocker for the release.
`G-31` should be narrowed to the prompts plus a re-review at release, so the two do not overlap.

**Agent behaviour on reaching it.** Stop. Report the pending count and the three decisions above.
Never fill a Korean string to make a count look complete.

---

### G-13 — Confirm the 3-year window is soft

> **CLOSED 2026-10-08 — soft.** The owner took the recommended default: three years is a starting value,
> always overridable, and the span actually used is recorded in the provenance record. `docs/10` §5
> question 1 is now struck through in both halves. **Nothing in the shipped code changes, and the build was already soft** — verified
> 2026-10-08: the window carries both year controls (`rh-search-years-from` and `rh-search-years-to` in
> `addon/content/searchDialog.xhtml`), and `SearchProvenance.dateFilter` is typed
> `{ fromIso, toIso } | "none"`, where `"none"` is the **All years** case FR-3 names. A hard window would
> have made that `"none"` arm unreachable. So this gate was confirming the design the build already has
> rather than asking for work.

**Blocks:** the search dialog design (`docs/11` §5 lists it as "Before Phase 1").

**What the human must do.** Answer the *one remaining half* of `docs/10` §5
question 1 — whether the 3-year default is **soft** and always overridable,
recorded in provenance (FR-3). The recommended default is soft, on the stated
ground that Persona C cannot use a hard window.

**Half of this gate is already discharged.** Question 1 also asked how wide the
window is, and the project owner settled that on 2026-09-09: **three calendar
years — the current year and the two before it — not a rolling 36 months.**
`docs/10` §5 question 1 now says so and marks the width "no longer open";
FR-3 was rewritten to match and defers the computation to `docs/08` §4.2;
`docs/02` §2.0 declares the same window for every source. `P1-T07`, `P1-T08` and
`P1-T20` already build it. Only hard-versus-soft remains, and it is not a
blocking question — see below.

**Why an agent cannot do it.** It is a product decision about who the tool is
for.

**Lead time.** Product-owner turnaround.

**If it is not done.** The recommended default is what gets built —
`docs/10` §5's preamble says so explicitly. This gate therefore *defaults* rather
than blocks; the agent proceeds on the recommended default and records that it
did.

**Agent behaviour on reaching it.** Do not stop. Build the recommended default,
and report in the task's completion note that the decision defaulted and where it
would be recorded if changed (`docs/10` §5 question 1).

---

### G-14 — Accept and monitor the maintainer-address obligation

**Blocks:** nothing technically; binds from the first outbound request.

**What the human must do.** Accept that D10's maintainer address ships in the
`User-Agent` on every host and in NCBI's `tool`/`email` parameters, is published
inside the XPI, and — as `docs/09` §8 item 5 puts it — "will receive real mail
from these services — it must be monitored". Also accept that changing it later
means editing docs 01, 02, 05, 09 and 13 (`docs/00` §3, D10).

**Why an agent cannot do it.** It is an ongoing personal commitment to receive and
act on abuse reports, and the address is the human's own.

**Lead time.** Ongoing from Phase 1 onward.

**If it is not done.** An abuse report or a rate-limit warning from NCBI, Crossref
or Europe PMC goes unread, and the first the project hears of it is a block. No
degraded path — the address is already committed by D10.

**Agent behaviour on reaching it.** Not an agent-blocking gate. Note it once, in
the Phase 1 completion report.

---

### G-15 — Authorize the first import into a real Zotero library

> **ANSWERED 2026-10-08: a separate practice library, never the everyday research library.** The owner
> chose to keep real research data out of this entirely.
>
> **Two things measured while recording this, both of which make the answer cheaper than it looked.**
> First, inside one Zotero profile there is only one personal library, so "a separate library" means **a
> separate profile** — which is already this project's convention: `G-02` asks for "a dedicated
> development profile separate from the real library", and `.scaffold/test/profile` is one. Second, and
> more useful: Phase 1's completion condition says **"a search for a real term imports ≥ 50 items into a
> new collection"** — a real *term*, not a real *library*. Re-read 2026-10-08 at `plan/02` §2, quoted
> verbatim from `docs/11` §1. **So the condition is satisfiable in the practice profile and the gate's
> stricter concern — writing to the human's own research data — does not arise.** `G-38`'s standing rule
> is untouched: any destructive action against the real library still needs its own permission.

**Blocks:** `docs/11` §1 Phase 1's DoD, which requires importing ≥ 50 real items
into a collection.

**What the human must do.** Say which library and which collection may be written
to, and confirm it is acceptable for the plugin to create items there. See G-38
for the broader rule.

**Why an agent cannot do it.** It writes to the human's real research data. NFR-20
forbids mutating user-authored data, and `docs/13` §8.1 requires that uninstalling
leaves previously created items intact — both of which are promises about the
human's library, not the agent's sandbox.

**Lead time.** Minutes.

**If it is not done.** Phase 1's DoD cannot be demonstrated. **Degraded path:** a
throwaway profile with a throwaway library proves the code but not the NFR-1
performance claim at realistic library size, which `docs/13` §8 later requires
against a ~10k-item library copy (G-34).

**Agent behaviour on reaching it.** Stop before the first write. Report the target
library and collection, the number of items to be created, and that a dedicated
test collection is preferred.

---

## 4. Phase 2 gates

### G-16 — Decide the preprint/published merge policy

> **DECIDED 2026-10-14 — keep both, linked.** The owner chose the `docs/10` §5 default: a preprint and its
> published version stay two Zotero items, connected through *Related*, the preprint tagged
> `research_helper/superseded-by-published`, so the preprint's date survives for trend analysis. `P2-T10`
> builds exactly this (coordinator note on the card); no merge of the two is to be offered in v1.

**Blocks:** the dedup engine (`docs/11` §5 lists it as "Before Phase 2"), and
inherited by Phase 5's recommendation presentation (`docs/05` §3.2).

**What the human must do.** Answer `docs/10` §5 question 2 — merge preprint and
published versions, or keep both linked via Zotero *Related* with a
`research_helper/superseded-by-published` tag. The recommended default is keep
both, because merging loses the preprint's date, which matters for trend analysis.

**Why an agent cannot do it.** It changes what the user's library means, and
`docs/11` R-18 rates a false merge as the failure Persona C fears most.

**Lead time.** Product-owner turnaround.

**If it is not done.** The recommended default is built (`docs/10` §5 preamble).

**Agent behaviour on reaching it.** Do not stop; build the recommended default and
say so. Escalate only if a task card requires behaviour the default does not
cover.

---

### G-17 — Label the ≥ 200-pair deduplication corpus

**Blocks:** `docs/11` §1 Phase 2's DoD, which requires precision ≥ 0.99 and recall
≥ 0.90 measured on a hand-labelled corpus.

*(Corrected 2026-10-26 (owner, `plan/00` §6 items 284(c) and 288(c)): the owner labels the recorded random sample of 60 of the 267 label-set pairs (`test/fixtures/dedup/label-sample.json`), not ≥ 200; the figures carry 95 % Wilson intervals, and Phase 2 may close on no false merge in the sample. The text below is the original wording.)*

**What the human must do.** Hand-label ≥ 200 record pairs as true or false
duplicates, including the hard cases — preprint/published pairs, corrigenda,
same-title different-cohort papers.

**Why an agent cannot do it.** The ground truth is the point. A corpus labelled by
the same class of system being evaluated measures agreement, not accuracy. This
is a domain judgement.

**Lead time.** Days of the human's own time.

**If it is not done.** R-18 cannot be retired by measurement and the 0.99
precision claim is unfounded. **Degraded path:** ship identifier-only auto-merge
with all fuzzy matches flagged for review — which `docs/10` §5 question 13's
recommended default already is — and defer the fuzzy threshold to v1.1.

**Agent behaviour on reaching it.** Stop at the evaluation task. Report how many
pairs are labelled, which categories are under-represented, and that the DoD
threshold cannot be evaluated without them.

---

## 5. Phase 3 gates

### G-18 — Enter API keys into the prefs pane

**Blocks:** `docs/11` §1 Phase 3's DoD; every LLM and TTS feature thereafter.

**What the human must do.** Open the Research Helper preferences pane and type
each key into the masked field, one provider at a time, then run "Test
connection" (FR-31) and confirm the storage-backend badge (`docs/09` §1.9 item 3)
shows the expected tier.

**Why an agent cannot do it.** Credential entry. This is prohibited outright, not
merely gated: an agent must never enter an API key into any field, and
`plan/README.md` §5 rule 5 states that a task appearing to require it is a defect
in the task.

**Lead time.** Minutes.

**If it is not done.** Nothing in Phases 3–6 can be exercised end to end. No
degraded path.

**Agent behaviour on reaching it.** Stop. Report which provider's key is needed,
where the field is, and that the agent will neither see nor handle the value.
Never write a key into a file, a fixture, a pref, a log or a commit — `docs/09`
§7's credential-storage and key-hygiene `[BLOCKER]` items are absolute.

---

### G-19 — Accept the residual key-storage risk statement

> **ACCEPTED 2026-10-23 (owner, `plan/00` §6 item 274(a)).** The owner accepted `docs/09` §1.8's
> five residual-risk paragraphs, which ship verbatim as `research-helper-prefs-risk-1` … `-5` (a unit
> test compares them with `docs/09`). Because paragraph 1 ("encrypted using your operating system's
> credential store") is untrue under tier 2, the owner also decided a tier-2 sentence — keys held in
> memory only, written nowhere, gone when Zotero closes — which `docs/09` §1.8 now carries and the pane
> shows **in place of paragraph 1** whenever `secretBackend` is `session`
> (`research-helper-prefs-risk-1-session`). Its Korean waits on `G-41`. The text below is the gate as
> it was posed.

**Blocks:** Phase 3's ship; `docs/09` §7's documentation `[BLOCKER]`.

**What the human must do.** Read `docs/09` §1.8's verbatim residual-risk statement
and accept it — specifically the sentence that **any other Zotero plugin runs in
the same privileged context and can decrypt the keys exactly as this one does**.
Confirm it appears unabbreviated in the prefs pane, since `docs/09` §7 marks that
a `[BLOCKER]`.

**Why an agent cannot do it.** It is acceptance of a real, un-mitigable risk to
the human's spendable credentials. `docs/11` R-9 describes the mitigation as
"retired by design, not accepted" for the storage question — but this specific
residual is accepted, and only the human can accept it.

**Lead time.** Minutes.

**If it is not done.** The prefs pane ships without the required text, which fails
a `[BLOCKER]` in `docs/09` §7 and therefore blocks the release.

**Agent behaviour on reaching it.** Stop. Quote `docs/09` §1.8 in full — it must
be reproduced verbatim, not paraphrased — and ask for explicit acceptance.

---

### G-20 — Decide whether the spend ceilings ship non-zero, and approve every later change

> **DECIDED 2026-10-23 (owner, `plan/00` §6 item 271(b)).** `run.maxSessionSpendCents` ships at
> **500** (US $5.00), so a first run can stop itself; `run.maxSpendCents` stays **0** (off). `docs/07`
> §8.5 moved first, then `src/prefs/schema.ts` and `addon/prefs.js` (`P3-T16`). The first half of the
> gate is closed; the second half stands — **every later change to a ceiling is still this gate**, and
> a mid-run "continue" raises a ceiling for that run only, never the preference. The text below is the
> gate as it was posed.

**Blocks:** Phase 3's prefs defaults; the release (`docs/10` §5 question 6's
residual half is still open).

**What the human must do.** Answer the question `docs/10` §5 question 6 actually
leaves open: should `run.maxSpendCents` or `run.maxSessionSpendCents` ship non-zero,
so a first run can stop itself rather than only warn? (Corrected 2026-10-20,
`plan/00` §6 item 245: the keys were ~~`run.maxSpendUSD`~~ and
~~`run.maxSessionSpendUSD`~~; a value is now whole US cents, so $5.00 is `500`.) If yes, change the defaults
in `docs/07` §8.5 — the question says "and nowhere else". Thereafter, approve
every change to a ceiling as its own act.

**Why an agent cannot do it.** It sets a limit on the human's own money, and
raising a ceiling is materially a spending authorization.

**Lead time.** Product-owner turnaround.

**If it is not done.** The schema's current defaults ship, which `docs/10` §5
question 6 states are both off — so nothing aborts on a limit the user did not
set, and the mandatory pre-run estimate plus the `summary.confirmAboveCents`
confirmation are the only protection (Corrected 2026-10-20, item 245: was
~~`summary.confirmAboveUSD`~~). That is a real degraded path, and it is the
current design; it is also exactly the exposure `docs/11` R-4 calls
reputationally fatal.

**Agent behaviour on reaching it.** Stop before changing any ceiling value.
Report the current default, the proposed value, and that `docs/07` §8.5 is the
only place it may be written.

---

### G-21 — Approve the first real summarization job's cost estimate

**Blocks:** `docs/11` §1 Phase 3's DoD — a 100-abstract job within the NFR-4
budget, reporting actual token usage.

**What the human must do.** Read the pre-flight dialog — item count, model, token
estimate, USD estimate, destination host, content scope, privacy mode (FR-24,
FR-36; `docs/09` §7's data-egress checklist) — and approve it. Then approve
separately the first run that uses full text, because D7 makes that the default
and `docs/00` §3 D7 puts the cost at roughly 8×, up to ~32× for chunked papers.

**Why an agent cannot do it.** It spends the human's money, and it sends the
human's content to a third party. `docs/09` §7 marks "no content is sent to any
provider without an explicit user action" a `[BLOCKER]`.

**Lead time.** Minutes.

**If it is not done.** The Phase 3 DoD is unmet and NFR-5's reference figure is
unmeasured. No degraded path — the measurement requires the spend.

**Agent behaviour on reaching it.** Stop. Report the dialog's exact contents,
including the "use abstracts instead" downgrade that `docs/11` R-4's mitigation
requires, before the first call.

---

### G-22 — Decide the R-19b outcome if the section detector misses its threshold

> **Decided 2026-11-10 by the owner, in chat, written 2026-11-12 (`G-22`; `plan/00` §6 items 365(d) and 374):** keep whole-document chunking without section labels (what the tree does), so `summary.fullTextMode`'s default stays `auto` and `IMRAD_DETECTOR_VALIDATED` stays false; and improve the detector, measuring the improvement once on a held-out set of twenty new papers (`plan/04` `P3-T40` and `P3-T41`) rather than on the forty labels it is tuned against. *This decision was given on 2026-11-10 and not written down until 2026-11-12, when `P3-T40`'s report found it missing.*

> **2026-11-13 (`P3-T41`; `plan/00` §6 item 377): the held-out measurement met the bar.** Measured once by the coordinator on commit 257b244: **92.94 %** (589 282 of 634 062 counted characters over the 15 held-out papers with IMRaD structure) against 85 % (`plan/reports/imrad-heldout-measurement-2026-11-13.md`; `docs/06` §4.3, note "Measured 2026-11-13 (held-out)"). The figure is recorded as `IMRAD_HELDOUT_MEASUREMENT`, so `IMRAD_DETECTOR_VALIDATED` is true and the detector's sections are passed on. The choice above — whole-document chunking without section labels — **now stands only as the fallback**, should the record be withdrawn; it is not the product's default any more. (Per paper, the flat path still applies wherever the detector recognizes fewer than two sections, as `docs/06` §4.3 has always said.) The gate's first sentence ("if the detector misses its threshold") no longer applies to the measured path. A second run on the held-out set needs the owner's decision. Only the owner marks this gate done.

**Blocks:** Phase 3's ship; the shape of Phase 4's W4-1 and W4-4
(`07-phase-4-trend-report.md` §5.1; `05-phases-4-7-outline.md` §1 until 2026-10-26).

**What the human must do.** If the 40-PDF measurement falls below `docs/06`
§4.3's ≥ 85 % target, choose between the two options `docs/11` R-19b names:
**ship whole-document chunking** (and drop section provenance from the summary
prompt), or **flip the default back to abstracts** — which reverses part of D7.

**Why an agent cannot do it.** It reverses or preserves a recorded design
decision (D7) with an 8×–32× cost consequence, and D-level decisions in
`docs/00` §3 are described as binding for v1, with changing one invalidating
parts of the design docs.

**Lead time.** Product-owner turnaround, once G-12's fixture set has been
measured.

**If it is not done.** `docs/11` R-19b's default applies: `auto` degrades to
whole-document chunking and the prompt must not claim section provenance. That
is a safe outcome, so this gate has a degraded path — but taking it silently
means the cost consequence of D7 was never re-examined.

**Agent behaviour on reaching it.** Stop. Report the measured accuracy, the two
options with their consequences, and that the answer must be written into
`docs/06` §4.3 and `docs/11` R-19b.

---

## 6. Phase 4 gates

### G-23 — Curate the 3 evaluation collections and their expected themes

**Blocks:** `docs/11` §1 Phase 4's deliverable list (a small evaluation set used
as a regression guard on prompt changes) and, through `docs/12` §17.5's migration
policy, every later prompt change.

**What the human must do.** Assemble three collections in their own domain and
write down the themes a competent reviewer would expect a trend report over each
to surface.

> *Added 2026-11-02 (`plan/00` §6 item 335(b)): the owner writes these on https://claude.ai/artifact/Lz2JAxGnCVUFuRJV8yiYcp, from collections the owner already has. `plan/reports/P4-T23.md` says what each set holds.*

**Why an agent cannot do it.** Domain judgement. The whole value of the set is
that a human who knows the literature decided what "right" looks like.

**Lead time.** Days of domain time.

**If it is not done.** Prompt changes ship without a regression guard, which is
the mitigation `docs/11` R-6 relies on. **Degraded path:** none that preserves
R-6's mitigation; the alternative is to freeze prompts, which `docs/12` §17.6
notes is costly anyway.

**Agent behaviour on reaching it.** Stop at the evaluation task. Report what the
set needs to contain and that generating the expected themes with the same
pipeline under test would be circular.

---

### G-24 — Domain spot-check of a generated trend report

**Blocks:** `docs/11` §1 Phase 4's DoD and `docs/13` §8.5's QA item.

**What the human must do.** Read a generated report and confirm the themes are
recognizable and no claim is obviously fabricated (`docs/13` §8.5). Separately
confirm the Korean report keeps titles, authors and venues in original script.

**Why an agent cannot do it.** It is the judgement R-6 and R-7 exist to protect —
whether the output is *true of the literature*, which is not checkable from
inside the pipeline that produced it. The citation validator (W4-5) proves
markers resolve; it cannot prove a claim is supported.

**Lead time.** Hours.

**If it is not done.** R-6 is unretired. **Degraded path:** the mechanical checks
(100 % of markers resolving, all eleven sections present) still pass, so the
release could proceed on those alone — which is precisely the failure mode
`docs/11` R-7 calls the most damaging for an academic tool.

**Agent behaviour on reaching it.** Stop. Report the report note's location, the
specific claims most worth checking, and that the mechanical validators passing
is not the same as the report being right.

---

### G-25 — Approve any write into a group library

**Blocks:** any group-library code path, in Phase 1's import as much as Phase 4's
report.

**What the human must do.** Confirm, per group, that generated content may be
written where all members will see it. `docs/10` §5 question 12's recommended
default is yes with write permission, but with an extra confirmation naming the
group.

**Why an agent cannot do it.** It publishes content to other people. It is a
real-account action with an audience the human, not the agent, is accountable to.

**Lead time.** Minutes.

**If it is not done.** Group-library paths are exercised only against a personal
library, and `docs/06` §16 item 7's question stays open.

**Agent behaviour on reaching it.** Stop before the write. Name the group, the
item count, and that the content will be visible to every member.

---

### G-42 — Approve the first real report run's cost estimate, and each paid Phase 4 run after it

**Added 2026-10-26** by the owner's decision on `plan/07`'s spend-gate line (`plan/00` §6 item 286),
modelled on `G-21`. The number is the next free one; `G-26`–`G-41` were already allocated.

**Blocks:** the three `plan/07` cards that spend — `P4-T23`'s baseline evaluation run, `P4-T24`'s
three determinism runs and `P4-T25`'s acceptance reports (and a live 400-item run there, only if
the owner asks for one) — and through them `docs/11` §1 Phase 4's DoD. No other Phase 4 card may
make a live call (`plan/07` §0.2 item 16).

**What the human must do.** Before each paid run, read the pre-flight dialog — the item count, the
missing summaries the run will make, every model the run sends to (map, report and critique), the
token and USD estimate with output priced at each call's ceiling, the destination host, the content
scope and privacy mode, and the report's egress notice (`plan/07` `P4-T16`; `docs/09` §3 row "3b.
Trend report") — compare it with the expected spend stated on the card's **Human gate** cell, and
approve or decline. The first approval is the first spend on the strong (`reportModel`) tier, so it
comes after `G-21` and `P3-T31`'s measured map phase; afterwards, compare the estimate with the
provider's reported usage, as `G-21` does for summaries.

**Why an agent cannot do it.** It spends the human's money on the most expensive action in the
product, and it sends the human's derived content — summaries, titles, years, venues and cluster
statistics — to a third party. `docs/09` §7 marks "no content is sent to any provider without an
explicit user action" a `[BLOCKER]`.

**Lead time.** Minutes per run.

**If it is not done.** `P4-T23`'s baseline score, `P4-T24`'s determinism verdict and `P4-T25`'s
live acceptance lines stay unmeasured, and Phase 4's DoD is unmet. **Degraded path:** only for the
400-item line, whose proof is `P4-T22`'s offline run (decided 2026-10-26); none for the others,
because each measurement requires the spend.

**Agent behaviour on reaching it.** Stop before the first call. Report the dialog's exact contents,
the card's expected spend and `P4-T16`'s estimate side by side, and which run this is (baseline,
determinism, acceptance); never start a paid run, and never reuse one approval for a later run.

---

## 7. Phase 5 gates

### G-26 — Enter the Semantic Scholar key, or decide to ship degraded

**Blocks:** Phase 5's scope (`05-phases-4-7-outline.md` §2.2).

**What the human must do.** If G-03's application was granted, enter the key in
the prefs pane (the same credential rule as G-18 applies). If it was not, decide
explicitly — answering `docs/10` §5 question 8 — that Phase 5 ships on the
citation-graph and lexical path, and accept the reduced DoD that `docs/11` §1
Phase 5 already states for the no-key case.

**Why an agent cannot do it.** Credential entry, plus a scope decision that
changes what the feature is.

**Lead time.** Minutes once G-03 resolves — but G-03 itself may take weeks.

**If it is not done.** Phase 5 cannot be started or scoped. **Degraded path
exists and is designed in:** `docs/11` R-3 requires relatedness to be usable with
zero Semantic Scholar calls, and `docs/13` §8.3 has a QA item that checks exactly
that.

**Agent behaviour on reaching it.** Stop. Report G-03's status, which work areas
(`05-phases-4-7-outline.md` §2.1 W5-3, W5-4) are affected, and that the fallback
path must be built regardless because R-3's mitigation requires it.

*Updated 2026-11-02:* `docs/10` §5 question 8 is decided (owner, `plan/00` §6 item 320(a)): no key is
required, and Phase 5 ships both paths, so this gate no longer scopes the phase; it blocks `P5-T29` and
`P5-T30`'s keyed lines. The key's rotation comes first and also blocks `P5-T31`, the owner's recording of the
Semantic Scholar fixtures with the key in the process environment (item 323(c)). The work areas are
`08-phase-5-related-papers.md` §5.1 since 2026-11-02.

---

### G-27 — Judge a collection profile and its recommendations

**Blocks:** `docs/11` §1 Phase 5's DoD, which requires that a 30-item collection
produce a profile **a domain expert judges reasonable**.

**What the human must do.** Inspect the generated profile — its MeSH terms,
keywords, authors, venues and themes — and the recommendations built from it, and
say whether they are reasonable for that collection.

**Why an agent cannot do it.** The DoD names a domain expert. `docs/05` §8 opens
by saying recommender quality is unfalsifiable by inspection because everything
looks plausible — which is exactly why the judge must know the field.

**Lead time.** Hours of domain time.

**If it is not done.** The DoD is unmet. **Partial degraded path:** the held-out
precision@k harness (`docs/05` §8.1) gives a number without a human, but it
measures re-finding papers the user already had, not whether new candidates are
good. *Corrected 2026-11-02: there is no degraded path. The harness is not built in Phase 5 (owner, `plan/00`
§6 item 323(d)), and this gate is the finishing condition.*

**Agent behaviour on reaching it.** Stop. Report the profile, the top candidates
with their reason chips, and the specific question the DoD asks.

---

### G-43 — Approve the first real recommendation run's cost estimate, and each paid Phase 5 run after it

**Added 2026-11-02** by the owner's decision of 2026-11-01 on `plan/08`'s spend-gate line (`plan/00` §6
item 321(a)), modelled on `G-42`. The number is the next free one.

**Blocks:** the one `plan/08` card that spends, `P5-T30`, and through it `docs/11` §1 Phase 5's DoD. No
other Phase 5 card may make a paid call (`plan/08` §0's definition of done). `P5-T04`, `P5-T29` and `P5-T31`
make live literature-database requests and spend nothing.

**What the human must do.** Before each paid run, read the pre-flight dialog — the paper count, the model,
the token and USD estimate with output priced at the call's 2 500-token ceiling, the destination host, the
content scope and privacy mode, and the egress notice (`plan/08` `P5-T22`; `docs/09` §3 row "6. Recommend") —
compare it with the expected spend stated on `P5-T30`'s **Human gate** cell, and approve or decline.
Afterwards, compare the estimate with the provider's reported usage, as `G-21` does for summaries.

**Why an agent cannot do it.** It spends the human's money, and it sends one metadata line per paper of the
human's collection — item key, title, year, venue and top subject terms — to a third party. `docs/09` §7
marks "no content is sent to any provider without an explicit user action" a `[BLOCKER]`.

**Lead time.** Minutes per run.

**If it is not done.** `P5-T30`'s recommendation lines stay unmeasured and Phase 5's DoD is unmet. **Partial
degraded path:** without a provider the profile is "heuristic" (FR-45 scenario 2; `P5-T22`), which spends
nothing and proves that path only; the DoD's `G-27` judgement of the real profile still needs the spend.

**Agent behaviour on reaching it.** Stop before the first call. Report the dialog's exact contents, the card's
expected spend and `P5-T22`'s estimate side by side, and which run this is; never start a paid run, and never
reuse one approval for a later run.

---

## 8. Phase 6 gates

### G-28 — Decide the audio register and the Korean-script source

> **Decided 2026-11-16 — this gate is closed.** The narrow half, `docs/12` §19 item 6, is the owner's
> (`plan/00` §6 item 378(a)): when only an English report exists, the Korean script is written from it in
> **one call**, as a spoken script newly written in Korean, not a sentence-by-sentence translation; titles
> and venue names stay untranslated. Questions 9 and 10 were then decided by the coordinator under item
> 313 as their recommended defaults (conversational, no citation markers read aloud, the written report as
> the source of record; the Korean script written natively), and `docs/10` §5 marks both. `plan/09`
> `P6-T06` and `P6-T08` build them. What follows is the gate as it was written.

**Blocks:** the script prompts (`docs/11` §5 lists both as "Before Phase 6").

**What the human must do.** Answer `docs/10` §5 question 9 (register — the length
half is already settled by `tts.targetMinutes` and `docs/04` §12's derivation) and
question 10 (generate the Korean script natively, or translate the English
report). Then answer the narrower variant, `docs/12` §19 item 6: when only an
English report exists, generate the Korean script from it in one call, or
generate a Korean report first in two.

**Why an agent cannot do it.** Question 10 and `docs/12` §19 item 6 are language
judgements about how Korean academic prose reads aloud; the register question is
a product-voice decision.

**Lead time.** Product-owner turnaround; the Korean half wants the same speaker
as G-11 and G-30.

**If it is not done.** The recommended defaults are built (`docs/10` §5 preamble)
— conversational register, native Korean generation — but `docs/12` §19 item 6
has no recommended default, so W6-2's call graph is genuinely undecided.

**Agent behaviour on reaching it.** Stop on the `docs/12` §19 item 6 half only;
proceed on the recommended defaults for questions 9 and 10 and say so.

---

### G-29 — Approve the paid calibration call that measures the audio token rate

> **Status 2026-11-16 — the measurement exists for one model; the re-verification is still owed.**
> `P0-T25` made one real, billed call on 2026-09-29 (`plan/01` `P0-T25`; `docs/04` §4.2's MEASURED
> note): `gemini-2.5-flash-preview-tts` returned `usageMetadata.candidatesTokenCount = 2709` for
> 108.37 s of audio, **24.998 tokens per second**, at a cost of $0.0273. The text below still calls the
> 25 tok/s figure `Unverified`; that is no longer true for that model. Two things remain: the rate has
> not been measured on any other TTS model (`gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts`),
> so `plan/09` `P6-T10` labels it measured for `gemini-2.5-flash-preview-tts` only; and `docs/04` §4.2
> asks for re-verification **by 2026-12-01**, because preview pricing changes. `plan/09` `P6-T04` (the
> owner's recording) reads the rate from its two TTS bodies and serves as that re-verification if it runs
> before 2026-12-01 on the same model; otherwise `P6-T19` does it. This gate stays open until one of them
> records it.

**Blocks:** Phase 6's cost estimator (`05-phases-4-7-outline.md` §3.2), and every
cost figure in `docs/04` §11.

**What the human must do.** Approve one real, billed Gemini TTS call whose only
purpose is calibration, then let the plugin read `usageMetadata.candidatesTokenCount`
and divide by the measured audio duration, exactly as `docs/04` §4.2 instructs.
Note that `docs/04` §4.2 also asks for re-verification by 2026-12-01 regardless
of the result, because preview-model pricing changes.

**Why an agent cannot do it.** It spends money (G-07's rule recurs), and on a
free-tier key it also triggers G-06's data-use consequence.

**Lead time.** Minutes.

**If it is not done.** The 25-tokens-per-second figure stays `> **Unverified:**`,
and `docs/04` §4.2 states in terms that the whole TTS cost model inherits that
uncertainty. **Degraded path, and it is the document's own instruction:** present
TTS costs as an order of magnitude, not a quote — which is a materially worse
product than FR-42 describes.

**Agent behaviour on reaching it.** Stop. Report the expected cost of the single
calibration call, that it replaces an unverified third-party figure, and that
until it runs no per-minute cost may be shown as a quote.

---

### G-30 — Rate 3 Korean audio samples

> *Noted 2026-11-16: still open. `plan/09` `P6-T19` is the card that stops for it; at least one of the
> three samples is written from an English-only report, the path the owner's item 378(a) chose.*

**Blocks:** `docs/11` §1 Phase 6's DoD, which requires a native Korean speaker to
judge the briefing natural at ≥ 4 average on a 5-point scale across 3 samples,
with correct pronunciation of embedded English technical terms. `docs/13` §8.6
repeats it as a QA item.

**What the human must do.** Listen to three generated Korean briefings and score
them, paying attention to the mixed Korean/English sentences that `docs/04` §9.1
identifies as the risk.

**Why an agent cannot do it.** A language and prosody judgement, with a numeric
threshold that the DoD makes binding.

**Lead time.** Hours, plus scheduling the speaker.

**If it is not done.** Phase 6's DoD is unmet and R-8 is unretired. **Degraded
path:** ship English audio only and hold Korean behind a flag with FR-43's
save-the-script-as-text fallback — a defensible v1 that gives up Feature 5's
headline value for a Korean-speaking owner.

**Agent behaviour on reaching it.** Stop. Report the three sample files, the
scale, and the specific pronunciation cases to listen for.

---

## 9. Phase 7 gates

### G-31 — Korean prompt and UI review by a native-speaking researcher

**Blocks:** the release. `docs/12` §19 item 4 states the Korean prompts "were
written by a non-native-reviewed process" and "need review by a Korean-speaking
researcher before release", naming the academic-register choices and the
term-with-English-in-parentheses convention specifically.

**What the human must do.** Have a Korean-speaking researcher review the `ko-KR`
UI bundle *and* the Korean prompt templates — `TREND_REPORT_KO` (`docs/12` §11)
and `AUDIO_SCRIPT_KO` (`docs/12` §14) — and record the corrections.

**Why an agent cannot do it.** A language judgement in a register (Korean
academic writing) that requires a domain-competent native speaker. It is also not
the same person-hours as G-11 and G-30: those judge *speech*, this judges
*written prompts and UI text*.

**Lead time.** Scheduling plus review; start looking in Phase 0 week 1.

**If it is not done.** Korean output ships unreviewed, against an explicit
"before release" instruction. **Degraded path:** ship English-only for generated
content while keeping the Korean UI — which contradicts FR-28 and D4's
localization commitment.

**Agent behaviour on reaching it.** Stop. Report which files need review
(`docs/12` §11, §14, and the `ko-KR` bundle), and note that a prompt change after
review re-triggers `docs/12` §17.2's version bump and §17.6's cost consequence —
so review before the prompts are frozen, not after.

---

### G-32 — ~~Confirm MIT licensing with the institution's IP office~~ — **CLOSED 2026-09-09**

**Blocks:** nothing. Closed by the project owner on 2026-09-09: institutional
clearance to publish this work under MIT has already been confirmed.

**Original concern, retained for the record.** D8 records MIT as decided, and
`docs/10` §5 question 18 carried the instruction to confirm with the
institution's IP office before first public release. That confirmation exists, so
the gate no longer blocks Phase 7 and no longer needs a slot in §1's start order.
`docs/10` §5 question 18 now records the same closure in its own text — the
question is struck through and marked "DECIDED 2026-09-09 by the project owner",
with the note that the earlier "Confirm with the institution's IP office" text
"is discharged and is no longer a release gate".

**What remains.** Nothing procedural. If the licence itself ever changes, or if
the work is later assigned to a different institution, reopen this gate rather
than assuming the 2026-09-09 clearance carries over — clearance was given for
MIT, for this project, under its current affiliation.

**Agent behaviour.** None required. Do not stop for this gate.

---

### G-33 — Screen-reader smoke test (NVDA, VoiceOver)

**Blocks:** NFR-13; `docs/11` §1 Phase 7's accessibility deliverable; `docs/13`
§8.7's QA item.

**What the human must do.** Run NVDA on Windows and VoiceOver on macOS against
every dialog, confirming that titles, control labels and job completion are
announced.

**Why an agent cannot do it.** It requires operating assistive technology and
judging what a screen-reader user would actually hear and understand — and
`docs/10` §3 marks Zotero 10's assistive-technology support surface
`> **Unverified:**`, so there is no documented expectation to check against
programmatically.

**Lead time.** Hours, across two OSes (depends on G-34).

**If it is not done.** NFR-13 cannot be marked measured. **Degraded path:**
`docs/11` §1 Phase 7's DoD permits an NFR to be *explicitly waived* with the
result recorded — so an honest waiver is available, an omission is not.

**Agent behaviour on reaching it.** Stop. Report the dialogs to test and the
three announcement classes to check, and offer to record the waiver text if the
test cannot be run.

---

### G-34 — Provide three-OS QA machines and a ~10k-item library copy

**Blocks:** `docs/13` §8, which requires Windows, macOS and Linux for a minor or
major release, a fresh profile with a fresh data directory for the install tests,
and a copy of a large real library (~10k items) for the performance tests.

**What the human must do.** Provide the three machines (overlapping G-09) and
make a **copy** — not the original — of a large real library for the performance
runs.

**Why an agent cannot do it.** Hardware provisioning, and the copy is a
data-safety decision about the human's own library (see G-38).

**Lead time.** Days if hardware must be arranged.

**If it is not done.** `docs/13` §8's performance and cross-platform sections
cannot be executed. **Degraded path:** `docs/13` §8 permits "Windows plus one
other" for a *patch* release only — so a v1.0 cannot take it.

**Agent behaviour on reaching it.** Stop. Report which OS and which fixture is
missing, and insist on a copy rather than the live library.

---

### G-35 — Publish the GitHub Release and the update manifest

**Blocks:** v1.0 and every later release.

**What the human must do.** Create the tag, let CI build from it, and publish the
GitHub Release with the XPI, `update.json`, `update-beta.json` where applicable,
and `SHA256SUMS.txt` (`docs/13` §7.1); confirm `update.json` on the `release`
branch advertises the new version with a correct `update_link` and `update_hash`
(`docs/13` §8.9); and confirm the in-place upgrade from the previous version
works.

**Why an agent cannot do it.** It publishes software under the user's identity to
a public audience, and `docs/09` §6.3 requires restricted tag/release permissions
with review on the release workflow — a control that an agent performing the
release would defeat.

**Lead time.** Minutes, once the checklist is signed off (G-37).

**If it is not done.** Nothing ships. No degraded path.

**Agent behaviour on reaching it.** Stop before creating a tag, pushing to a
public branch, or triggering the release workflow. Report the version, the
checklist state, and the `docs/09` §7 supply-chain `[BLOCKER]` items that must be
green first.

---

### G-36 — Announce in the Zotero Forums and submit to community lists

**Blocks:** R-20's mitigation; `docs/13` §7.2's distribution plan.

**What the human must do.** Post the announcement in the Zotero Forums covering
what `docs/13` §7.2 item 2 enumerates — including data egress, key storage and
the license — and submit to the community plugin lists. Also answer `docs/10` §5
question 20: list at v1.0 or wait.

**Why an agent cannot do it.** Publishing a message to a public forum under the
user's identity, and making public claims about data handling that the human is
accountable for.

**Lead time.** Hours to write; community-list turnaround is unknown, and
`docs/13` §7.2 marks the submission mechanics and one list's maintenance status
`> **Unverified:**`, instructing confirmation of the live process immediately
before submitting.

**If it is not done.** Discovery is limited to the repository. **Degraded path:**
the GitHub Release stays the canonical source (`docs/13` §7.1), which is a real
distribution channel — just a quieter one.

**Agent behaviour on reaching it.** Stop. Provide a draft covering `docs/13` §7.2
item 2's required points and report that the agent will not post it.

---

### G-37 — Sign off the release checklist, including NFR waivers

**Blocks:** v1.0 (`docs/11` §1 Phase 7's DoD requires every NFR to have a measured
or explicitly waived result recorded).

**What the human must do.** Walk `docs/13` §8's checklist, record each result in
the release issue, and explicitly waive — with a reason — anything not measured.
Confirm every `[BLOCKER]` in `docs/09` §7 is resolved.

**Why an agent cannot do it.** It is the accountability step: someone signs that
the software is fit to publish. Several checklist items are themselves human
judgements (G-24, G-27, G-30, G-33).

**Lead time.** Hours.

**If it is not done.** The release is unauthorized. No degraded path.

**Agent behaviour on reaching it.** Stop. Report the checklist with every item's
state and every unmeasured NFR listed as requiring an explicit waiver.

---

## 10. Cross-cutting gates

### G-38 — Any destructive action against the user's real Zotero library

**Blocks:** nothing scheduled; applies at every phase.

**What the human must do.** Authorize, per occurrence, any operation that could
destroy or alter data in a real library. The class includes: pointing dev-serve
or a test run at the real profile rather than the dev profile (G-02); the
uninstall test, which `docs/13` §8.1 requires to leave items, collections, notes
and audio attachments intact; "Remove generated notes from collection" (FR-20),
which `docs/13` §8.4 requires to confirm the exact count first; "Clear generated
summaries", which `docs/13` §8.7 requires to leave the user's own notes intact;
bulk imports; and any write to a group library (G-25).

**Why an agent cannot do it.** It is irreversible loss of the human's research
data. NFR-20 forbids mutating user-authored data, and `docs/09` §3.7's clearable
data list is deliberately scoped so that clearing plugin state never touches
Zotero notes. Permanent deletion of user data is outside what an agent may do
regardless of instruction.

**Lead time.** Per occurrence.

**If it is not done.** The relevant test or feature is exercised only against a
throwaway library. That is usually the right answer anyway; the gate exists so
the choice is deliberate.

**Agent behaviour on reaching it.** Stop before the operation. Report exactly
what will be deleted or modified, how many items, whether it is reversible, and
propose a throwaway profile instead.

---

### G-39 — Rotate or revoke a key after suspected exposure

**Blocks:** nothing scheduled; applies whenever a key may have leaked.

**What the human must do.** Rotate the key at the provider and re-enter it
(G-18). `docs/09` §2.5 covers rotation; `docs/09` §1.8's residual-risk text tells
the user to "rotate any key you think may have been exposed"; and `docs/09` §6.4
requires the post-compromise plan to name "rotate all configured API keys" as the
first user instruction.

**Why an agent cannot do it.** Credential handling at the provider's console —
account access and credential entry, both prohibited.

**Lead time.** Minutes, but must be immediate.

**If it is not done.** A spendable credential stays live after exposure. No
degraded path.

**Agent behaviour on reaching it.** Stop everything that uses the key. Report
what was exposed and where — a log, a fixture, a commit, a screenshot — and that
rotation must happen before any further call. `docs/09` §2.4 additionally
specifies that a 401 pauses the job rather than failing it, does not retry, and
does not delete the key; an agent must not "helpfully" clear stored credentials.

---

## 11. What an agent reports at a gate

Every stop should produce the same five things, so the human can act without
re-reading the plan:

1. **The gate ID and title**, so it can be looked up here.
2. **Exactly what is needed** — the value, the click, the judgement, the approval
   — in one sentence.
3. **What is blocked right now**: the task ID or spike, and what else waits behind
   it.
4. **Whether a degraded path exists**, named from this file, and what it costs.
5. **Where the answer must be recorded** — the owning document and section, so the
   decision does not live only in a chat log.

And never: a guessed value, a placeholder credential, a workaround that avoids
the gate, or a claim that the gate was satisfied.

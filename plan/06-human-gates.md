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
| Phase 0, week 1 | G-04 | Register the NCBI `tool`/`email` pair; obtain the optional NCBI key | Phase 1 politeness; Phase 7 release | Unknown; treat as days-to-weeks |
| Phase 0, week 1 | G-01 | Create the GitHub repository and grant permissions | Everything (`P0-T01`) | Minutes |
| Phase 0, week 1 | G-02 | Provide the Zotero 10 install, dev profile and `.env` paths | Phase 0 entirely | Hours |
| Phase 0, week 1 | G-05 | Create provider accounts and obtain LLM/TTS keys | V-7, V-10, Phase 3 | Hours; Gemini billing linkage may take longer |
| Phase 0, week 1 | G-09 | Provide macOS and Linux machines, one without libsecret | V-16, V-5, Phase 7 QA | Days to weeks if hardware must be arranged |
| Phase 0, week 1 | G-11 | Line up a native Korean speaker | V-10, and again in Phases 6 and 7 | Scheduling a person; days |
| Phase 0, week 1 | G-31 | Line up a Korean-speaking researcher for prompt review | Phase 7 | Scheduling; days to weeks |
| Phase 0, week 1 | G-12 | Assemble the 40-PDF IMRaD fixture set | Phase 3 ship, Phase 4 | Days of the human's own time |
| Phase 0, early | G-06 | Acknowledge the Gemini free-tier data-training terms | Any Gemini call, incl. V-10 | Minutes, but must precede the first call |
| Phase 0, early | G-07 | Approve the first paid API call and the spike spend | V-7, V-10 | Minutes |
| Phase 0 | G-08 | Install the XPI by hand; run the teardown cycles | V-1, V-4, Phase 0 DoD | Minutes per cycle |
| Phase 0 | G-40 | Approve the two throwaway public releases of the V-18 update dry run | V-18, R-15 | Minutes, once G-01 is done |
| Phase 0, end | G-10 | Decide the Linux-without-libsecret fallback tier | Phase 3 prefs design | Product-owner turnaround |
| Before Phase 1 | G-13 | Confirm the 3-year window is soft (the *width* was settled 2026-09-09: three calendar years) | Search dialog design | Product-owner turnaround |
| Phase 1 | G-14 | Accept and monitor the maintainer-address obligation | Ongoing from the first outbound request | Ongoing |
| Phase 1 | G-15 | Authorize the first import into a real Zotero library | Phase 1 DoD | Minutes |
| Before Phase 2 | G-16 | Decide the preprint/published merge policy | Dedup engine | Product-owner turnaround |
| Phase 2 | G-17 | Label the ≥ 200-pair deduplication corpus | Phase 2 DoD | Days of the human's own time |
| Phase 3 | G-18 | Enter API keys into the prefs pane | Phase 3 DoD, all LLM features | Minutes |
| Phase 3 | G-19 | Accept the residual key-storage risk statement | Phase 3 ship | Minutes |
| Phase 3 | G-20 | Decide whether the spend ceilings ship non-zero | Phase 3 prefs defaults | Product-owner turnaround |
| Phase 3 | G-21 | Approve the first real summarization job's cost | Phase 3 DoD | Minutes |
| Phase 3 | G-22 | Decide the R-19b outcome if the detector misses its threshold | Phase 3 ship, Phase 4 shape | Product-owner turnaround |
| Phase 4 | G-23 | Curate the 3 evaluation collections and expected themes | Phase 4 DoD | Days of domain time |
| Phase 4 | G-24 | Domain spot-check of a generated trend report | Phase 4 DoD, R-6/R-7 | Hours |
| Phase 4 | G-25 | Approve any write into a group library | Group-library paths | Minutes |
| Phase 5 | G-26 | Enter the Semantic Scholar key, or decide to ship degraded | Phase 5 scope | Minutes once G-03 resolves |
| Phase 5 | G-27 | Judge a collection profile and its recommendations | Phase 5 DoD | Hours of domain time |
| Before Phase 6 | G-28 | Decide the audio register and the Korean-script source | Script prompts | Product-owner turnaround |
| Phase 6 | G-29 | Approve the paid calibration call that measures the audio token rate | Phase 6 cost model | Minutes |
| Phase 6 | G-30 | Rate 3 Korean audio samples | Phase 6 DoD | Hours, native speaker |
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

---

### G-10 — Decide the Linux-without-libsecret fallback tier

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

### G-13 — Confirm the 3-year window is soft

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

**Blocks:** Phase 3's prefs defaults; the release (`docs/10` §5 question 6's
residual half is still open).

**What the human must do.** Answer the question `docs/10` §5 question 6 actually
leaves open: should `run.maxSpendUSD` or `run.maxSessionSpendUSD` ship non-zero,
so a first run can stop itself rather than only warn? If yes, change the defaults
in `docs/07` §8.5 — the question says "and nowhere else". Thereafter, approve
every change to a ceiling as its own act.

**Why an agent cannot do it.** It sets a limit on the human's own money, and
raising a ceiling is materially a spending authorization.

**Lead time.** Product-owner turnaround.

**If it is not done.** The schema's current defaults ship, which `docs/10` §5
question 6 states are both off — so nothing aborts on a limit the user did not
set, and the mandatory pre-run estimate plus the `summary.confirmAboveUSD`
confirmation are the only protection. That is a real degraded path, and it is the
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

**Blocks:** Phase 3's ship; the shape of Phase 4's W4-1 and W4-4
(`05-phases-4-7-outline.md` §1).

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
good.

**Agent behaviour on reaching it.** Stop. Report the profile, the top candidates
with their reason chips, and the specific question the DoD asks.

---

## 8. Phase 6 gates

### G-28 — Decide the audio register and the Korean-script source

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

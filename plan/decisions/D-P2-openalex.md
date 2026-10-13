# D-P2-openalex — OpenAlex is out of v1

**Decided:** 2026-09-09 (`docs/02-literature-database-apis.md` §9.3) · **Recorded:** 2026-10-13 ·
**Card:** `P2-T15` · **Status:** closed

This is a decision record (`docs/07-architecture-and-data-model.md` §2.2.1): it records an
argument, not a measurement, and it ratifies what the design corpus already says. It changes no
design document. A later change of mind is a new dated record and the document rows named in §5
below, never a rewrite of this one.

## 1. The decision

**OpenAlex ships nothing in v1.** No adapter, no member of the `sources` preference, no `SecretId`,
no rate-limit policy row, no preference row of any kind, and no query is emitted for it.

The deciding records, in order of authority:

1. **`docs/00-overview.md` §3 D2** — the confirmed v1 source list: PubMed, Europe PMC, Crossref,
   Semantic Scholar, arXiv, bioRxiv, medRxiv. OpenAlex is not in it.
2. **`docs/10-requirements-and-user-stories.md` §4 item 10** — out of scope for v1: "Scopus, Web
   of Science, Dimensions, OpenAlex and CORE are out. OpenAlex is the most likely v1.1 addition."
3. **`docs/02-literature-database-apis.md` §9.3** — the document that used to argue the other way.
   Its former recommendation ("ship OpenAlex as an opt-in supplementary source, disabled by
   default") is **withdrawn** there, on 2026-09-09, because a confirmed decision and a scope
   statement outrank a technical recommendation. §9's opening line is the operative sentence:
   "Nothing in §9.1 or §9.2 authorises building an adapter."

An implementer who reads `docs/02` §9.1 and §9.2 without reaching §9.3 will conclude the opposite.
That is the whole reason this file exists. Do not re-litigate the decision from §9.1/§9.2; they are
retained **v1.1 research** (§3 below).

## 2. What is reserved, and must not be reused

Three identifiers stay in the code on purpose (`docs/07` §5.1, `src/model/ids.ts`):

- the `openalex` member of the `SourceId` union, mirrored by `SOURCE_ID_SET` and therefore accepted
  by `isSourceId`;
- the `OpenAlexId` brand;
- the `ExternalIds.openAlexId` slot.

They are **reserved, not shipped**. They stay so the id, the brand and the slot cannot be reused for
a different source, and so `docs/02`'s mirrored copy of the union and `schema/provenance.schema.json`'s
`sourceId` enum do not have to diverge. The consequences `docs/07` §5.1 draws: nothing may put
`openalex` in the `sources` preference (`docs/07` §8.5 — "**not** a valid member"; the Values column
reads "from the `SourceId` union minus `openalex`"); `docs/07` §7.3's policy table has no
`api.openalex.org` row; and `docs/02` §10.4's four OpenAlex precedence entries are **inert** — left in
place, in their current positions, because they are the ordering a v1.1 adoption would need
(`P2-T10`). `docs/02` §12.2's OpenAlex query block is headed "no query is emitted in v1".

Two more facts the corpus records for the day the source is reconsidered: abstracts arrive as an
inverted index and are reconstructed lossily, so OpenAlex is last in §10.4's `abstract` ordering and
must stay last (`docs/02` §9.2: "Prefer any other source's abstract over OpenAlex's"); and the
`mailto=` polite pool is **superseded** by the metered key (`docs/02` §9.1) — do not plan on it.

## 3. Why the evaluation is kept rather than deleted

`docs/02` §9.1 and §9.2 are the only place in the corpus that records the February 2026 metering
change, the verified per-call prices (list/filter $0.0001, search $0.001, PDF/XML $0.01), the two
working key-transmission mechanisms (`api_key=` query parameter and `Authorization: Bearer`), the
inverted-index abstract reconstruction, and the fact that the `mailto=` polite pool is superseded.
Those facts are perishable and were measured live on 2026-09-08. A v1.1 decision needs them, and
re-deriving them means re-running live probes. Deleting a finished evaluation because its verdict
changed is how the same question gets researched twice (`docs/02` §9.3, "Why the research is kept").

The evaluation's own points also carry the standing reasons for and against: metering is fatal to a
default-on client-side design (every user behind one institutional address shares a $0.10/day budget
without a key); everything OpenAlex offers is available elsewhere free (search → Europe PMC +
Crossref; citations → Semantic Scholar + Europe PMC; recommendations → Semantic Scholar); its
abstract quality is the worst of any source; and it has genuinely the best coverage for fields PubMed
and arXiv serve poorly — which is the argument for v1.1, not for v1.

## 4. What a v1.1 adoption costs

Copied from `docs/02` §9.3 so the estimate is not a surprise. Beyond the adapter itself:

- a new `SecretId` in `docs/09-security-privacy-and-api-keys.md` §1.7 (`docs/02` §2.3 already says
  an OpenAlex key "would need a new `SecretId` added there before" implementation);
- an `openalex.keyPresent` row in `docs/07` §8.5 — and, by `docs/07` §11.1 step 9, the full trio
  with `openalex.lastValidatedAt` and `openalex.lastValidationResult`, since a credential-holding
  source gets all three;
- an `api.openalex.org` row in `docs/07` §7.3 — which has to be **designed, not copied**: OpenAlex is
  budget-bound (a daily USD meter, `docs/02` §9.1; `X-RateLimit-Remaining-USD`) rather than
  rate-bound, and `src/core/rateLimit/hostLimiter.ts`'s `readAdvertisedRate` documents that its
  `X-RateLimit-Limit: 1000` is a daily count, not a rate (`docs/02` §2.4's `BUDGETS` comment);
- a budget-exhausted UI state ("OpenAlex daily budget exhausted", then silent fall-back to the free
  sources);
- asking the user for a **third** API key, after Semantic Scholar and their LLM provider.

**The three document rows go in before any code** (`docs/07` §11.1 steps 4 and 9; §11.2 step 5
states the same order for providers). Under no outcome is OpenAlex enabled by default. If adopted,
the key goes through the keystore, never a preference (decision D5), and never into a URL query
parameter in any logged form — `docs/13-testing-build-and-release.md` §3.2's recorder redaction
strips `api_key`/`key`/`token` parameters from fixtures for exactly this reason.

## 5. How the decision is enforced

**In CI.** `.github/workflows/ci.yml`, job `lint`, step "Assert no OpenAlex surface ships
(P2-T15)". It fails the build on any of:

1. a file or directory whose path contains `openalex` under `src/`, `addon/` or `test/` — an adapter
   directory (`docs/07` §11.1 step 1) or a fixture set (step 5);
2. a non-comment line in `src/` or `addon/` containing `openalex` (case-insensitive), outside the
   allowlist below — this is the `sources` member in `addon/prefs.js` or `src/prefs/schema.ts`, an
   `openalex.*` preference row, a `SecretId` in `src/core/secretStore.ts` or `src/zotero/keychain.ts`,
   a row in `src/core/rateLimit/hostLimiter.ts`, a slot in `src/bootstrap/registerSources.ts`, or any
   other code that names the source;
3. `openalex.org` on a non-comment line anywhere in `src/` or `addon/`, allowlist or not.

The allowlist is `src/model/` (the three reserved identifiers of §2, and `docs/02` §10.4's inert
precedence entries once `src/model/merge.ts` exists) and the single display-name row
`openalex: "OpenAlex",` in `src/zotero/itemMapper.ts`, which `Record<SourceId, string>` makes
mandatory. Comment lines are skipped because `addon/prefs.js` and `hostLimiter.ts` state the
exclusion in their own comments — the word is not a surface. `schema/provenance.schema.json`'s
`sourceId` enum mirrors the union and is not scanned. `test/` contents are not scanned (tests
legitimately assert the reserved member), only `test/` paths.

**Measured 2026-10-13**, on a byte-identical copy of `src/`, `addon/` and `test/`: each surface was
reintroduced in turn and the step failed with the classification shown; a comment-only mention did
not fail it.

| Reintroduced | Where | Step's classification |
|---|---|---|
| `,openalex` appended to the `sources` default | `addon/prefs.js` | preference row or sources member |
| `,openalex` appended to the `sources` default | `src/prefs/schema.ts` | preference row or sources member |
| `pref("openalex.keyPresent", false);` | `addon/prefs.js` | preference row or sources member |
| `"source.openalex"` in `SECRET_IDS` | `src/core/secretStore.ts` | SecretId |
| `{ host: "api.openalex.org", … }` in `HOST_POLICIES` | `src/core/rateLimit/hostLimiter.ts` | rate-limit policy row, and the host-name check |
| `OPENALEX_HOST = "api.openalex.org"` inside the allowlisted directory | `src/model/ids.ts` | the host-name check |
| `src/sources/openalex/openalexSource.ts` | adapter directory | path check, and adapter code |
| `test/fixtures/openalex/works.json` | fixture directory | path check |
| `readonly openalex?: LiteratureSource;` in `SourceAdapters` | `src/bootstrap/registerSources.ts` | source registration |
| `// openalex …` comment | `src/prefs/schema.ts` | **passes** (control) |

**At run time — not enforced as of 2026-10-13.** `P2-T15`'s third criterion asks that a `sources`
value containing `openalex` be rejected with a typed error, asserted by a unit test. No such
validator exists and the card's `Files` list names no file that could hold one. What the shipped code
does instead: `isSourceId` (`src/model/ids.ts`) accepts the reserved member; `toPipelineInput`
(`src/ui/viewModels/searchImportViewModel.ts`) keeps it; `validateSearchImportInput`
(`src/pipeline/searchImport/searchImportPipeline.ts`) checks that the list is non-empty but not its
membership; and the pipeline's `run` finds no adapter in the registry, records a per-source warning
("this build has no adapter for that database") through `missingAdapterReport`, and continues with
the other sources. So an `openalex` member never registers or queries a source — but it is skipped
with a warning, not rejected with a typed error. Making it a typed error is a follow-up outside this
card's files.

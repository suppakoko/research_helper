pricetable-and-nfr10-265: the user price table is stored in the plugin database, and the NFR-10 startup test no longer counts Zotero's own hosts (plan/00 §6 item 265, decisions (b) and (d))

VERDICT
Done. Both decisions are built, tested and documented.
- Decision (b): the price table the user edits is now a database table, `user_price`. It is added by a new migration (schema version 4, the next after 3), and docs/07 §8.3 describes it first, with the owner's dated note.
- A store with read, upsert (insert or replace) and delete runs on the one shared connection. The service graph publishes it as `database.prices`, and the model catalogue reads it through its existing `userPriceOverrides` port.
- No screen edits the table yet. The card notes are added.
- Decision (d): the NFR-10 test now skips a named list of Zotero's own hosts. It still counts every other new host, and every request that carries the plugin's User-Agent header, whatever its host.
- All checks exit 0 on the final state: typecheck, lint:check, `npx eslint .`, `npm run test` and `npm run build`.
- The integration suite was run three times. Run 1 had one failure, caused by a defect in my own new test (details under Runs). Runs 2 and 3 passed all 189 tests.
- All 21 mutants were killed. The final `grep -rn MUTANT src test addon typings scripts` is empty. No Zotero process is left running. Nothing is committed.

FILES CHANGED, WITH DECLARATION NAMES
- docs/07-architecture-and-data-model.md, §8.3 only. Three small exact-string insertions, each made right after re-reading the spot:
  - a dated blockquote: "Decided 2026-10-21 (owner; `plan/00` §6 item 265): the user-edited price table lives in the plugin database …";
  - a placement-table row "User-edited model prices (`UserPriceOverride`) | SQLite `user_price` …";
  - the DDL in the schema sketch, after `idx_cache_lru`.
- src/bootstrap/migrations.ts: new `USER_PRICE_DDL`. `MIGRATIONS` gains `{ version: 4, statements: [USER_PRICE_DDL] }`. The header comment is updated.
- src/llm/shared/pricing.ts:
  - new port `UserPriceStore` (`list`, `upsert`, `delete`), declared here so that `llm/` never imports `zotero/`;
  - new `isUsableUserPriceOverride`, which adds a closed-set provider check and a non-empty model id check to the existing rules;
  - internal `USER_PRICE_PROVIDERS`. The header comment is updated.
- src/llm/shared/modelCatalogue.ts:
  - `ModelCatalogueDeps.userPriceOverrides` now accepts a function that returns a list or a Promise of a list;
  - new internal `readUserPrices`: if the read fails, it logs a warning and treats the table as empty;
  - the header note "No store holds that table yet …" is replaced by a dated update.
- src/zotero/db.ts:
  - new `createUserPriceStore(db)`, beside `createJobStore`;
  - internals `USER_PRICE_COLUMN_LIST`, `UPSERT_USER_PRICE` (`ON CONFLICT … DO UPDATE`), `SELECT_USER_PRICES` (ordered by provider, then model), `DELETE_USER_PRICE`, `userPriceFrom`;
  - imports `redactRecord`, `isUsableUserPriceOverride` and the two types. The header list is updated.
- src/bootstrap/pluginDatabase.ts:
  - `OpenPluginDatabase.prices` and `PluginDatabase.prices` (a `UserPriceStore`);
  - the wrapper waits for the database to open and migrate (`ready`), tracks calls in flight, and refuses calls once teardown has begun;
  - teardown now waits for price calls in flight before `closeDatabase`. The header and the teardown-order text are updated. src/bootstrap/container.ts is not edited: the graph already exposes `database`.
- Tests that pin the schema version, moved from 3 to 4:
  - test/unit/core/provenanceRerun.test.ts: the version test is renamed "… and user_price as version 4"; a fresh file ends at version 4; the expected object list gains `table:user_price`; the idempotence test now runs from 4 to 4.
  - test/unit/core/jobQueue.test.ts: a version-1 file now goes to version 4.
  - test/unit/core/cache.test.ts: both migration tests now end at 4, and are renamed.
  - test/unit/bootstrap/container.test.ts: `schemaVersion: 4`. This file was not in the brief's list; grep found it.
  - test/integration/zotero/provenanceStore.spec.ts: schema version 4, `table:user_price`, and the `user_price` columns and types read back.
- New tests:
  - test/integration/zotero/provenanceStore.spec.ts: a user-price round-trip test (named under Tests).
  - test/unit/zotero/userPriceStore.test.ts (new).
  - test/unit/llm/pricing.test.ts: two tests; the harness gains the options `userPrices` and `logger`.
- Decision (d):
  - test/integration/support/startupRequests.ts (new, pure, so it runs in Node): `ObservedRequest`, `ZOTERO_OWN_HOSTS`, `PLUGIN_USER_AGENT_PREFIX`, `hostOf`, `isPluginRequest`, `isZoteroOwnRequest`, `countedStartupHosts`.
  - test/integration/phase1-dod.spec.ts:
    - `ObservedChannel` gains `getRequestHeader`;
    - new `httpChannel` and `LOOPBACK_PROBE_PORT`;
    - `recordingRequests` also records each request's User-Agent;
    - `hostsOf` now uses `hostOf`;
    - the NFR-10 test uses `countedStartupHosts`, with a dated comment recorded against items 176 and 265 (d), and logs the requests it excused;
    - one new test (named under Tests).
  - test/unit/integration/startupRequests.test.ts (new).
- plan/04-phase-3-llm-summaries.md:
  - P3-T13 step 4 gains a dated note that the table now exists;
  - P3-T14 step 5 gains a dated note that the preferences pane must edit the table through `PreferencesHostApi` and `database.prices`.
  - Someone else had edited this file on disk between my reads; both of my edits were exact-string and applied cleanly.

THE DDL AS SHIPPED (docs/07 §8.3 and USER_PRICE_DDL, byte for byte)
-- Decided 2026-10-21 (owner; plan/00 §6 item 265): the user-edited price table, one row per
-- provider and model, in the shape of P3-T13's UserPriceOverride. Fractional US dollars per
-- million tokens (item 252), never cents. Migration version 4 is this statement, byte for byte.
CREATE TABLE user_price (
  provider_id               TEXT NOT NULL,     -- a ProviderId
  model_id                  TEXT NOT NULL,     -- as the picker lists it for provider_id
  input_per_mtok_usd        REAL NOT NULL CHECK (input_per_mtok_usd >= 0),
  output_per_mtok_usd       REAL NOT NULL CHECK (output_per_mtok_usd >= 0),
  cached_input_per_mtok_usd REAL CHECK (cached_input_per_mtok_usd >= 0),   -- NULL: unknown
  as_of                     INTEGER NOT NULL,  -- epoch ms: when the user read these prices
  PRIMARY KEY (provider_id, model_id)
);
(The three comment lines above `CREATE TABLE` are in docs/07 only. `USER_PRICE_DDL` is the statement itself, inline comments included.)

Redaction: one stored text field can carry text the user typed. The pane accepts a model id the user types in (P3-T14's Done-when line). The provider id comes from a closed set and is validated. So `upsert` passes the model id through `redactRecord`, and if the gate would change it, the row is refused rather than stored redacted, because a changed id would no longer name its model. Every other column is a number.

THE HOST LIST AND ITS EVIDENCE
`ZOTERO_OWN_HOSTS = ["api.zotero.org"]`, with the comment "add a host only with a run log".
- The evidence, as cited in the code comment:
  - Zotero's `https://api.zotero.org/retractions/list` download was counted on 2026-10-15 (plan/00 §6 item 176);
  - it was counted in P2-T26's run Z4;
  - it was counted in runs 1 and 4 of plan/reports/after-hooks-264.md, 2 of 5 runs on 2026-10-21 (item 265 (d)).
- My three runs saw no request in either window, so no host was added.
- The exclusion is strict:
  - the URL must be `https:`;
  - the host is compared whole, so `www.zotero.org`, `zotero.org`, `api.zotero.org.example.test` and `api.zotero.org:8443` are all still counted;
  - a request that carries the plugin's User-Agent (`research_helper/…`) is counted whatever its host, even if the window with the plugin absent saw that host too.
- Measured inside Zotero 10.0.3 (runs 2 and 3):
  - the plugin's own HttpClient request shows "research_helper/0.0.2 (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)" on the channel;
  - Zotero's own request shows "Mozilla/5.0 (…) Gecko/20100101 Zotero/10.0.3".

TESTS BY NAME
test/unit/zotero/userPriceStore.test.ts (15):
- copies user_price from docs/07 §8.3 byte for byte, under the owner's dated decision
- migrates a fresh file to version 4 with user_price's columns, types and key, read back
- brings a version-3 file to version 4 without touching cache_entry
- refuses a negative price written around the store, and allows an unknown cached price
- round-trips fractional US dollars per million tokens exactly, never cents (item 252)
- upserts in place: one row per provider and model, the later edit winning
- keeps one model ID under two providers apart, and lists by provider then model
- deletes one row and leaves the others; deleting a missing row changes nothing
- refuses an unusable row and writes nothing
- passes the model ID through redactRecord: an ordinary ID is stored unchanged, a credential-shaped one is refused
- reads back only usable rows: a provider a later build added is dropped
- publishes the store on the connection it opened, and a call made before the open settles lands in the file
- with no database, lists an empty table and rejects a write
- closes the connection only after a price write in flight, and refuses calls afterwards
- prices a model at the user's stored row, even on the bundled fallback list
test/unit/llm/pricing.test.ts (2 new):
- reads the table through an asynchronous port, as the plugin database's store answers it
- logs a failed read of the table and keeps the catalogue's own prices
test/unit/integration/startupRequests.test.ts (7):
- names api.zotero.org, and only it, as Zotero's own host
- does not count Zotero's own retractions/list download, the item 176 failure
- counts a request carrying the plugin's User-Agent, whatever its host, api.zotero.org included
- counts a plugin request even when the control window saw the same host
- still counts every other new host, compared whole rather than by suffix or substring
- excludes Zotero's host alongside, without hiding a new host seen with it
- reads a host the way URL does: case-folded, default port dropped, a non-URL kept whole
Integration:
- provenanceStore.spec.ts: "creates research-helper.sqlite … at schema_version 4 …" (moved); new: "round-trips the user price table on the same connection: fractional dollars, an upsert in place, a delete". It also checks that the table's CHECK constraint refuses a negative price inside Zotero.
- phase1-dod.spec.ts: "NFR-10: startup adds a measurable, bounded cost and issues no network request" (changed); new: "NFR-10's recorder reads the plugin's User-Agent off a real channel, and counts it even on Zotero's own host (loopback only)". The new test sends requests to 127.0.0.1:59321, where nothing listens; the connection is refused and nothing leaves the machine.

RUNS
- npm run typecheck: exit 0.
- npm run lint:check: exit 0 ("All matched files use Prettier code style!").
- npx eslint .: exit 0.
- npm run test, final run: unit 71 files, 3333 tests passed; contract 2 files, 40 tests passed.
  - An earlier run failed one test of the other agent: llmPool.test.ts "does not ask when the budget runs out with nothing left to dispatch" (5 s timeout). At that moment queue.ts and llmPool.test.ts were being edited by that agent. It passed on the rerun; I did not touch it.
- npm run build: exit 0, "Build finished". The only warnings are the existing ko-KR "missing" ones.
- Integration (`npm run test:integration -- --exit-on-finish`). Before each run, `grep -rn MUTANT …` was empty and no zotero.exe was running.
  - Run 1, 14:22–14:25: 188 passed, 1 failed. The failure was my new recorder test: "the plugin's loopback request was not observed". Cause: I first used port 9, which Gecko bans, so neither request reached http-on-modify-request. I moved the probe to port 59321 (`LOOPBACK_PROBE_PORT`) and documented why. This was not an intermittent failure.
  - Run 2, 14:27–14:30: 189 passed.
  - Run 3, 14:32–14:35: 189 passed.
  - NFR-10 in all three runs: startup delta 18, 15 and 14 ms against the 200 ms budget; 0 requests in either window.
- No Zotero process was left behind, and none had to be killed.

MUTANTS
21 mutants at unit level. Each was marked /* MUTANT id */, live only for its own vitest run, restored by copying the backup back, and verified by SHA-256. Runner: scratchpad/mutants265.mjs. All were killed, each by the intended test:
- U1, db.ts, model id not gated: killed (1)
- U2, db.ts, unusable row not refused: killed (1)
- U3, db.ts, list keeps unusable rows: killed (1)
- U4, db.ts, upsert keeps the old input price: killed (1)
- U5, db.ts, upsert leaves the cached price unchanged: killed (1)
- U6, db.ts, delete by provider OR model: killed (1)
- U7, db.ts, NULL cached price read as 0: killed (2)
- U8, pluginDatabase.ts, teardown does not wait for writes in flight: killed (1)
- U9, pluginDatabase.ts, calls after teardown reach the closed connection: killed (1)
- U10, pluginDatabase.ts, a write with no database resolves silently: killed (2)
- U11, migrations.ts, cached-price CHECK dropped: killed (2)
- U12, pricing.ts, any provider accepted: killed (2)
- U13, modelCatalogue.ts, a failed table read fails the catalogue: killed (1)
- U14, modelCatalogue.ts, async port not awaited: killed (3)
- N1, startupRequests.ts, a plugin request to api.zotero.org is excused: killed (1)
- N2, host matched by suffix: killed (1)
- N3, host matched as a substring of the URL: killed (2)
- N4, a plugin request on a host the plugin-absent window saw is excused: killed (1)
- N5, nothing is ever counted: killed (5)
- N6, http: excused: killed (1)
- N7, User-Agent prefix misspelt: killed (3)
Final hashes:
- db.ts b674d608…629a
- pluginDatabase.ts 6aca49b4…0a0b
- migrations.ts 71d90a69…ae2a
- pricing.ts 65889bed…8441
- modelCatalogue.ts db6a9cfd…d166
- startupRequests.ts ac2317a2…09cc
The final `grep -rn MUTANT src test addon typings scripts` is empty (exit 1). No mutant touched useTranslators. None was run inside Zotero.

CONTRADICTIONS
1. plan/04 §0.2 item 4 says two tests pin the schema version. Five do: provenanceRerun.test.ts, jobQueue.test.ts, cache.test.ts, container.test.ts (not in the brief's list) and provenanceStore.spec.ts. All five were moved.
2. P3-T13's catalogue port was synchronous, and a database read is not. The port now also accepts a Promise. That file is P3-T13's, not the other agent's.
3. §0.2 item 5's list of persisted records that must pass the redaction gate does not name this table. Because the pane accepts a typed model id, the model id is gated anyway, with refusal rather than redaction.
4. `user_price` is the first DDL in §8.3 with CHECK constraints. The CHECKs allow Infinity; the code refuses it (`isUsableUserPriceOverride`).
5. The NFR-10 test is now stricter in one respect than before: a request with the plugin's User-Agent is counted even when the plugin-absent window saw the same host. This follows "every request the plugin sends must still fail the test".
6. The note that the pane must edit the table went on P3-T14, the card that already wires the catalogue into the pane, not on P3-T04, the pane-shell card. Move it if P3-T04 is meant.
7. Item 176 is recorded in the spec's comment as asked. plan/00 §6 itself was not edited.

WHAT I DID NOT CHECK
- Upgrading a real user's version-3 file that holds data to version 4 inside Zotero. The integration profile's starting version was not logged; the upgrade from 3 is checked only in Node.
- The teardown wait for an in-flight price write inside Zotero (checked in Node only), and the exact error Zotero raises when a CHECK fails (the spec checks only that the insert throws).
- Any editing screen: none exists (P3-T14).
- That `ZOTERO_OWN_HOSTS` is complete. My runs saw no Zotero traffic at all, so the list rests on earlier reports only.
- Why the loopback recorder test takes about 4.3 s. It is probably the refused connection being retried at the operating-system level; this was not measured.
- No mutant was run in the integration suite.
- No live network was used. Nothing was committed.

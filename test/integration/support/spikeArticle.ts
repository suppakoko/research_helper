/**
 * `P0-T10`'s fixture article, for the integration suite (`plan/10` `P7-T04`).
 *
 * Until 2026-11-17 the plugin shipped a developer command, Tools ▸ Research
 * Helper ▸ "Create spike item (P0-T10)", that wrote this one article into this
 * one collection (`src/zotero/zoteroApi.ts`'s `createSpikeArticle`).
 * `P7-T04` retired the command (`plan/00` §5 backlog item 25). The fixture
 * work and the collection name moved here unchanged. The writer is now the
 * shipped one, {@link importWorks} (`src/zotero/importer.ts`), as the card's
 * `Files` row says (`plan/00` §6 item 388(b)).
 *
 * **Caller:** `test/integration/zotero/itemCreation.spec.ts`, which asserts
 * V-2's item round trip on what this writes.
 *
 * No network, no LLM (`docs/13` §2.3): the work is fixed local data, and
 * `importWorks` is given no translator lookup.
 */

import type { CanonicalWork } from "../../../src/model/canonicalWork";
import { normalizeDoi } from "../../../src/model/ids";
import { importWorks, type ImportReport } from "../../../src/zotero/importer";

/**
 * The collection the fixture is written into.
 *
 * ASCII and free of path separators on purpose (`docs/01` §12 gotcha 19), and
 * carrying the task ID so it is obvious in a library what put it there.
 */
export const SPIKE_COLLECTION_NAME = "Research Helper spike (P0-T10)";

/** The fixture DOI, through the one normalizer that produces a `Doi` (`docs/02` §11.1). */
const SPIKE_DOI = normalizeDoi("10.5555/research-helper-p0-t10");
if (SPIKE_DOI === null) {
  throw new Error("research_helper: the P0-T10 spike DOI must normalize");
}

/**
 * The one article. Fixed data, not fetched: `docs/01` §5.8 and §12 gotcha 13
 * forbid network I/O inside a transaction.
 *
 * `provenance.seenIn` is **empty on purpose**: this record came from no
 * literature source, so there is no `SourceId` that honestly belongs there.
 * The consequence is visible and intended — the shipped mapper writes no
 * `rh-sources` line and no `libraryCatalog`, and `extra` carries exactly
 * `docs/07` §6.3's mandatory `rh-work-key`.
 */
export const SPIKE_WORK: CanonicalWork = {
  workKey: `doi:${SPIKE_DOI}`,
  ids: { doi: SPIKE_DOI },
  type: "journal-article",
  title: "Research Helper spike article (P0-T10)",
  abstract:
    "Created by the research_helper P0-T10 toolchain spike to prove that the " +
    "plugin can write a journalArticle, its creator, its DOI and its " +
    "collection membership into a Zotero library.",
  authors: [{ family: "Lovelace", given: "Ada" }],
  provenance: { recordIds: [], fieldOrigin: {}, seenIn: [] },
  normalizedAtEpochMs: 0,
};

/**
 * Write {@link SPIKE_WORK} into {@link SPIKE_COLLECTION_NAME} in the user
 * library, creating the collection when it is missing and reusing it when it
 * is not.
 *
 * `duplicatePolicy: "import-anyway"`: every call writes one new item, as the
 * retired command did on every click, so an earlier copy in the library can
 * never turn a call into a link and leave the caller's "exactly one item"
 * assertion counting nothing.
 */
export async function writeSpikeArticle(): Promise<ImportReport> {
  return importWorks({
    works: [SPIKE_WORK],
    collectionName: SPIKE_COLLECTION_NAME,
    duplicatePolicy: "import-anyway",
  });
}

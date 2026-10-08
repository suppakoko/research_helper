/**
 * `P1-T36` — `FR-8`'s third scenario at layer 1: the record's lifetime, and the
 * export action that needs it to still exist.
 *
 * ## What this file is for
 *
 * `FR-8`'s third scenario is *"**When** the user chooses "Export provenance as
 * JSON", **Then** a JSON file matching the documented schema is written to a
 * user-chosen path"*. The file writing was already done before this card —
 * `src/core/provenance.ts`'s `exportJson` and `serializeProvenance`, covered by
 * `test/unit/core/provenance.test.ts`. What was missing is that **the record did
 * not survive the import handler**: it was composed as a local `const`, handed
 * to the note writer, and dropped. So the thing this file measures is the
 * record's *lifetime*, which is `P1-T36`'s own `Notes` paragraph:
 *
 * | failure mode | the assertion that catches it |
 * |---|---|
 * | not retained at all | `an import retains the run's record` |
 * | **stale** — a second run exported as the first | `a second import replaces the retained record`, `a search clears the retained record` |
 * | **unredacted** — a leak waiting for the next feature | `the retained record is the redacted one`, `the exported bytes carry no credential-shaped run` |
 * | an empty file written with no record | `an export with no record writes nothing` |
 *
 * ## Why layer 1 and not the integration spec
 *
 * `P1-T22` and `P1-T35` both reported the same `Files` gap: the view model's
 * arithmetic had no unit test and was asserted only through a live window at
 * integration cost — and that suite is load-sensitive (`plan/00` §6 item 20).
 * Everything below runs in plain Node against a stub pipeline, so a wrong
 * lifetime fails in two seconds rather than in a window that may also be slow
 * for an unrelated reason. The integration spec still reads a real file back off
 * disk and validates it against the shipped schema, because that is the half
 * only a real platform can prove.
 *
 * ## Nothing here is a real credential
 *
 * {@link KEYISH} is generated in this file from a repeated hexadecimal pattern.
 * It is 48 characters, which is **above** `src/core/errors.ts`'s 40-character
 * last-resort pattern — the point `P1-T17` measured and `P1-T22` closed three
 * surfaces over is that a 32-character NCBI-shaped key is *below* it. A test
 * that used 32 characters here and watched the value survive would be asserting
 * the hole rather than the gate.
 */

import { describe, expect, it } from "vitest";

import { createSystemClock } from "../../../src/core/clock";
import type { CancellationToken } from "../../../src/core/jobQueue/cancellation";
import type { ProgressSnapshot } from "../../../src/core/jobQueue/progress";
import { createLogger } from "../../../src/core/logger";
import type {
  ProvenanceFileWriter,
  SearchProvenance,
} from "../../../src/core/provenance";
import type { CanonicalWork } from "../../../src/model/canonicalWork";
import type { SourceRecord } from "../../../src/model/sourceRecord";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../../../src/pipeline/searchImport/types";
import type { Pipeline, PipelineContext } from "../../../src/pipeline/types";
import { NEW_COLLECTION_VALUE } from "../../../src/ui/dialogs/searchDialog";
import type {
  SearchWindowImportRequest,
  SearchWindowQuery,
} from "../../../src/ui/dialogs/searchDialog";
import {
  createSearchImportViewModel,
  type SearchImportJobFactory,
  type SearchImportViewModelDeps,
  type SearchImportViewModel,
} from "../../../src/ui/viewModels/searchImportViewModel";

// ---------------------------------------------------------------------------
// 1. Synthetic inputs
// ---------------------------------------------------------------------------

/**
 * A credential-**shaped** run, built here, matching nothing that exists.
 *
 * 48 characters of `[A-Za-z0-9]`, so `/\b[A-Za-z0-9_-]{40,}\b/g` removes it.
 */
const KEYISH = `rh${"0123456789abcdef".repeat(2)}bbbbbbbbbbbbbb`;

/** What the single redaction gate leaves in its place. */
const REDACTION_MARK = `[redacted:${String(KEYISH.length)}]`;

const PLUGIN_VERSION = "0.0.2-test";
const ZOTERO_VERSION = "10.0.3-test";

function query(overrides: Partial<SearchWindowQuery> = {}): SearchWindowQuery {
  return {
    mode: "keyword",
    keyword: "ionizable lipid nanoparticle",
    fromYear: 2024,
    toYear: 2026,
    maxResults: 25,
    sources: ["pubmed"],
    filter: "",
    hideExisting: true,
    duplicates: "skip",
    collectionID: `${NEW_COLLECTION_VALUE}:RH P1-T36`,
    ...overrides,
  };
}

function importRequest(
  overrides: Partial<SearchWindowQuery> = {},
): SearchWindowImportRequest {
  return { ...query(overrides), records: [] };
}

/**
 * One `searchImport` output whose write half succeeded.
 *
 * Only the members {@link import("../../../src/ui/viewModels/searchImportViewModel").buildProvenance}
 * reads are interesting; the rest are the shape's required fields.
 */
function output(overrides: {
  readonly collectionKey: string;
  readonly created: number;
}): SearchImportOutput {
  return {
    outcome: "succeeded",
    stageReached: "writingItems",
    records: [] as readonly SourceRecord[],
    works: [] as readonly CanonicalWork[],
    perSource: [
      {
        sourceId: "pubmed",
        transmittedQuery: `db=pubmed&term=crispr&api_key=${KEYISH}`,
        requestedLimit: 25,
        dateFilterApplied: "server",
        recordsRetrieved: overrides.created,
        droppedOutOfWindow: 0,
        keptWithoutDate: 0,
        recordsDeduplicatedAway: 0,
        error: undefined,
        warnings: [],
      },
    ],
    write: {
      libraryId: 1,
      collectionKey: overrides.collectionKey,
      collectionName: "RH P1-T36",
      collectionCreated: true,
      created: overrides.created,
      linkedExisting: 0,
      skipped: 0,
      failed: 0,
      abstractCoveragePercent: 100,
      partialNoteRecorded: false,
    },
    error: undefined,
    warnings: [],
    cancellationKind: undefined,
  };
}

/** A `searchImport` run that wrote nothing — a preview, or a refused write. */
function previewOutput(): SearchImportOutput {
  return {
    outcome: "succeeded",
    stageReached: "backfillingAbstracts",
    records: [] as readonly SourceRecord[],
    works: [] as readonly CanonicalWork[],
    perSource: [],
    write: undefined,
    error: undefined,
    warnings: [],
    cancellationKind: undefined,
  };
}

// ---------------------------------------------------------------------------
// 2. The stubs: a pipeline, a job factory, a file writer
// ---------------------------------------------------------------------------

/** Every call the writer saw, so a test can read the bytes that were written. */
interface RecordingWriter extends ProvenanceFileWriter {
  readonly calls: { path: string; text: string }[];
}

function recordingWriter(behaviour: "ok" | "throws" = "ok"): RecordingWriter {
  const calls: { path: string; text: string }[] = [];
  return {
    calls,
    writeTextFile: (path: string, text: string): Promise<unknown> => {
      calls.push({ path, text });
      if (behaviour === "throws") {
        return Promise.reject(new Error("the platform refused the write"));
      }
      return Promise.resolve(undefined);
    },
  };
}

/**
 * The job factory, reduced to what `runJob` touches: a context, a reporter whose
 * `done()` is a no-op, an `events.subscribe` that never fires, and `dispose`.
 *
 * No snapshot is published, so nothing below depends on the progress tree — the
 * record's lifetime is a function of the pipeline's *output*, not of its
 * progress, and a test that drove snapshots would be measuring `P1-T22`.
 */
function jobFactory(): SearchImportJobFactory {
  return {
    forJob: () => ({
      jobId: "job-1",
      context: {
        token: { isCancelled: false } as unknown as CancellationToken,
      } as unknown as PipelineContext,
      progress: {
        reporter: {
          done: (): void => undefined,
        },
        events: {
          subscribe: (_listener: (snapshot: ProgressSnapshot) => void) => () =>
            undefined,
        },
      },
      dispose: (): void => undefined,
    }),
  };
}

/** A pipeline that returns a queued output per `run()` call, in order. */
function pipelineReturning(
  outputs: readonly SearchImportOutput[],
): Pipeline<SearchImportInput, SearchImportOutput> {
  const queue = [...outputs];
  return {
    id: "searchImport",
    displayNameKey: "research-helper-search-run",
    stages: [],
    validate: () => ({ ok: true, errors: [] }),
    // Never called: `runJob` runs the pipeline directly. Present because
    // `Pipeline` declares it, with every member of `PipelineEstimate` at zero.
    estimate: () =>
      Promise.resolve({
        itemCount: 0,
        externalRequests: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCostUsd: undefined,
        estimatedDurationSeconds: 0,
        notesKeys: [],
      }),
    run: (): Promise<SearchImportOutput> => {
      const next = queue.shift();
      if (next === undefined) throw new Error("the stub pipeline ran out");
      return Promise.resolve(next);
    },
    resumable: false,
  };
}

/** Every line the view model logged, so a refusal can be shown to be reported. */
interface Harness {
  readonly model: SearchImportViewModel;
  readonly writer: RecordingWriter;
  readonly lines: string[];
}

function harness(options: {
  readonly outputs: readonly SearchImportOutput[];
  /** Omit to leave `provenanceFiles` unbound — the degradation path. */
  readonly writer?: RecordingWriter;
}): Harness {
  const lines: string[] = [];
  const writer = options.writer ?? recordingWriter();
  const deps: SearchImportViewModelDeps = {
    pipeline: pipelineReturning(options.outputs),
    jobs: jobFactory(),
    logger: createLogger({
      sink: {
        write: (line: string) => {
          lines.push(line);
        },
      },
      clock: createSystemClock(),
      level: "debug",
    }),
    pluginVersion: PLUGIN_VERSION,
    zoteroVersion: ZOTERO_VERSION,
    clock: { now: () => 1_760_000_000_000 },
    ...(options.writer === undefined ? {} : { provenanceFiles: writer }),
  };
  return { model: createSearchImportViewModel(deps), writer, lines };
}

/** The record as the export wrote it, parsed back out of the stub's bytes. */
function writtenRecord(writer: RecordingWriter, at = 0): SearchProvenance {
  const call = writer.calls[at];
  if (call === undefined) throw new Error(`no write at index ${String(at)}`);
  return JSON.parse(call.text) as SearchProvenance;
}

// ---------------------------------------------------------------------------
// 3. Retention — the record has to still exist
// ---------------------------------------------------------------------------

describe("P1-T36: the retained provenance record", () => {
  it("retains the run's record, so the export has something to write", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 3 })],
      writer,
    });

    await model.runImport(importRequest());
    expect(await model.exportProvenance("/tmp/rh-one.json")).toBe("written");

    expect(writer.calls).toHaveLength(1);
    const record = writtenRecord(writer);
    expect(record.targetCollectionKey).toBe("AAAA1111");
    expect(record.totals.imported).toBe(3);
    // The two version strings come from the dependencies, which is what makes
    // the exported file a record of *this* build rather than of nothing.
    expect(record.pluginVersion).toBe(PLUGIN_VERSION);
    expect(record.zoteroVersion).toBe(ZOTERO_VERSION);
  });

  it("replaces the retained record on a second import, so a stale run is never exported", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [
        output({ collectionKey: "AAAA1111", created: 3 }),
        output({ collectionKey: "BBBB2222", created: 7 }),
      ],
      writer,
    });

    await model.runImport(importRequest());
    await model.runImport(importRequest());
    expect(await model.exportProvenance("/tmp/rh-two.json")).toBe("written");

    // **The second run's record, and only it.** A retention that appended, or
    // one that kept the first, would still write a schema-valid file — which is
    // why this asserts the collection key and the count rather than validity.
    const record = writtenRecord(writer);
    expect(record.targetCollectionKey).toBe("BBBB2222");
    expect(record.totals.imported).toBe(7);
  });

  it("clears the retained record when a search replaces what the window shows", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [
        output({ collectionKey: "AAAA1111", created: 3 }),
        previewOutput(),
      ],
      writer,
    });

    await model.runImport(importRequest());
    // A search: the table is now a fetch nobody has imported, so the previous
    // import's record no longer describes the run on screen.
    await model.runSearch(query());

    expect(await model.exportProvenance("/tmp/rh-three.json")).toBe(
      "no-record",
    );
    expect(writer.calls).toHaveLength(0);
  });

  it("clears the retained record when an import writes nothing", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [
        output({ collectionKey: "AAAA1111", created: 3 }),
        previewOutput(),
      ],
      writer,
    });

    await model.runImport(importRequest());
    // A second import whose write half did not run — cancelled before
    // `CreatingCollection`, or failed. `renderImportOutcome` composes no record
    // in that branch, and the previous one must not stand in for it.
    await model.runImport(importRequest());

    expect(await model.exportProvenance("/tmp/rh-four.json")).toBe("no-record");
    expect(writer.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The export action
// ---------------------------------------------------------------------------

describe("P1-T36: the export action", () => {
  it("writes nothing when no record is present, and says so", async () => {
    const writer = recordingWriter();
    const { model, lines } = harness({ outputs: [], writer });

    // Nothing has run at all: the state the code shipped in before this card.
    expect(await model.exportProvenance("/tmp/rh-none.json")).toBe("no-record");
    expect(writer.calls).toEqual([]);
    expect(lines.some((line) => line.includes("no record to write"))).toBe(
      true,
    );
  });

  it("writes to exactly the path it was handed, and nothing else", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.runImport(importRequest());
    await model.exportProvenance("/tmp/rh-chosen.json");

    expect(writer.calls.map((call) => call.path)).toEqual([
      "/tmp/rh-chosen.json",
    ]);
  });

  it("refuses an empty destination", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.runImport(importRequest());
    expect(await model.exportProvenance("")).toBe("no-path");
    expect(writer.calls).toEqual([]);
  });

  it("reports a missing file-writing port instead of throwing", async () => {
    // `provenanceFiles` unbound: the degradation path, which is what the
    // composition root's `Required<SearchImportViewModelDeps>` exists to stop
    // reaching a user.
    const { model, lines } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
    });

    await model.runImport(importRequest());
    expect(await model.exportProvenance("/tmp/rh-unbound.json")).toBe(
      "no-writer",
    );
    expect(lines.some((line) => line.includes("no file-writing port is"))).toBe(
      true,
    );
  });

  it("reports a writer that threw, and keeps the record for a second attempt", async () => {
    const writer = recordingWriter("throws");
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.runImport(importRequest());
    expect(await model.exportProvenance("/tmp/rh-fails.json")).toBe("failed");
    // A failed write must not consume the record: a user whose first
    // destination was unwritable gets to choose another one.
    expect(await model.exportProvenance("/tmp/rh-fails-again.json")).toBe(
      "failed",
    );
    expect(writer.calls).toHaveLength(2);
  });

  it("is reachable through the host the document runs on", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.host.runImport(importRequest());
    // Through `host`, not through `model`: the document has no other handle,
    // and `P1-T35` is the card that made the host reachable at run time.
    expect(await model.host.exportProvenance("/tmp/rh-host.json")).toBe(
      "written",
    );
    expect(writer.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Redaction — the retained record is the safe one
// ---------------------------------------------------------------------------

describe("P1-T36: what reaches the file", () => {
  it("writes the redacted record: no credential-shaped run survives", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    // The query carries the synthetic run as well, so both of §5.3's free-text
    // fields are exercised: `userQuery` and `perSource[].transmittedQuery`.
    await model.runImport(importRequest({ keyword: `crispr ${KEYISH}` }));
    expect(await model.exportProvenance("/tmp/rh-redacted.json")).toBe(
      "written",
    );

    const call = writer.calls[0];
    expect(call).toBeDefined();
    const text = call?.text ?? "";
    // The bytes, not the parsed object: a redaction that missed one field would
    // still parse.
    expect(text).not.toContain(KEYISH);
    // And the single gate's own marker is there, so the value was redacted
    // rather than the whole field being dropped.
    expect(text).toContain(REDACTION_MARK);

    const record = writtenRecord(writer);
    expect(record.userQuery).toBe(`crispr ${REDACTION_MARK}`);
    // **The two free-text fields are cleaned by two different mechanisms, and
    // measured here rather than assumed.** `userQuery` goes through
    // `redactText`, which substitutes the marker. `transmittedQuery` goes
    // through `redactQueryString`, which **removes the whole `api_key`
    // parameter** rather than marking its value — so the marker is correctly
    // absent from it and the parameter is gone. A test that expected a marker
    // in both places failed on the first run against unmutated code, which is
    // how this distinction was found.
    expect(record.perSource[0]?.transmittedQuery).toBe("db=pubmed&term=crispr");
    expect(record.perSource[0]?.transmittedQuery).not.toContain("api_key");
  });

  it("writes pretty-printed, newline-terminated JSON — FR-8's shape", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.runImport(importRequest());
    await model.exportProvenance("/tmp/rh-shape.json");

    const text = writer.calls[0]?.text ?? "";
    // `serializeProvenance`'s contract, asserted here because this is the first
    // caller of it in the product: two-space indent and a trailing newline.
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 1,');
  });

  it("never puts the chosen path into the record or the file", async () => {
    const writer = recordingWriter();
    const { model } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.runImport(importRequest());
    const path = "/Users/a-real-person/Desktop/rh-provenance.json";
    await model.exportProvenance(path);

    // `P1-T36`'s third **Do NOT**: a path can carry an account name, so it is
    // not in the record, not in the file, and not in a log line either.
    const text = writer.calls[0]?.text ?? "";
    expect(text).not.toContain(path);
    expect(text).not.toContain("a-real-person");
  });

  it("keeps the chosen path out of every log line", async () => {
    const writer = recordingWriter();
    const { model, lines } = harness({
      outputs: [output({ collectionKey: "AAAA1111", created: 1 })],
      writer,
    });

    await model.runImport(importRequest());
    const path = "/Users/a-real-person/Desktop/rh-provenance.json";
    await model.exportProvenance(path);

    // `docs/09` makes no statement about writing a chosen filesystem path to
    // the debug log — §2.1 is about credentials and §2.2 about the debug
    // bundle — so `P1-T36`'s **Do NOT** is followed to the letter and the
    // question is recorded with the card rather than answered here.
    expect(lines.some((line) => line.includes("a-real-person"))).toBe(false);
    // The outcome *is* logged, so the export is not silent.
    expect(lines.some((line) => line.includes("provenance JSON written"))).toBe(
      true,
    );
  });
});

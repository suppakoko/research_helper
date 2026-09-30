import { beforeEach, describe, expect, it, vi } from "vitest";

import { createManualClock, type ManualClock } from "../../../src/core/clock";
import {
  createLogger,
  DEFAULT_LOG_LEVEL,
  LOG_PREFIX,
  NULL_LOG_SINK,
  redactContext,
  type LogLevel,
  type LogSink,
} from "../../../src/core/logger";

/**
 * `P1-T02`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * The card's fourth acceptance criterion is asserted against the **emitted
 * text**, not against the object handed to the sink: `docs/09` §2.1 level 2 is a
 * claim about what reaches a debug log a user pastes into a GitHub issue, and a
 * structure-only assertion would pass on a logger that leaked through
 * `JSON.stringify`'s own traversal.
 */

/** A sink that keeps every line, so a test can assert on the log's text. */
interface RecordingSink extends LogSink {
  readonly lines: { line: string; zoteroLevel: number }[];
  readonly reported: string[];
  text(): string;
}

function createRecordingSink(): RecordingSink {
  const lines: { line: string; zoteroLevel: number }[] = [];
  const reported: string[] = [];
  return {
    lines,
    reported,
    write(line, zoteroLevel) {
      lines.push({ line, zoteroLevel });
    },
    reportError(line) {
      reported.push(line);
    },
    text() {
      return lines.map((l) => l.line).join("\n");
    },
  };
}

let sink: RecordingSink;
let clock: ManualClock;

beforeEach(() => {
  sink = createRecordingSink();
  clock = createManualClock(1_757_300_000_000);
});

function loggerAt(level: LogLevel) {
  return createLogger({ sink, clock, level });
}

const LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

// ---------------------------------------------------------------------------
// The card's fourth acceptance criterion
// ---------------------------------------------------------------------------

describe("the card's redaction criterion", () => {
  const CTX = {
    api_key: "abc123",
    url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&api_key=abc123",
  };

  it.each(LEVELS)(
    'at level "%s", { api_key, url } emits neither occurrence of the secret',
    (level) => {
      // Verbatim: "A logger call carrying { api_key: "abc123",
      // url: "…?api_key=abc123" } emits neither occurrence of the secret, at
      // every level including `debug`."
      const log = createLogger({ sink, clock, level: "debug" });
      log[level]("request finished", CTX);
      expect(sink.lines).toHaveLength(1);
      expect(sink.text()).not.toContain("abc123");
    },
  );

  it("redacts both occurrences by different rules, and says so", () => {
    const log = loggerAt("debug");
    log.debug("request finished", CTX);
    const line = sink.lines[0]?.line ?? "";
    // The field rule: the key matched KEYISH_FIELD, so the value went whatever
    // it looked like. "abc123" matches no KEY_PATTERNS entry.
    expect(line).toContain('"api_key":"[redacted:6]"');
    // The URL rule: the parameter was removed, not blanked.
    expect(line).toContain("db=pubmed");
    expect(line).not.toContain("api_key=");
  });

  it("redacts a secret that arrived only in the message", () => {
    const log = loggerAt("debug");
    log.debug("sending sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 now");
    expect(sink.text()).not.toContain("sk-ant-api03-A");
    expect(sink.text()).toContain("[redacted:");
  });

  it("redacts a secret nested inside a context object", () => {
    const log = loggerAt("debug");
    log.debug("request", {
      request: { headers: { Authorization: "Bearer abc123", Accept: "json" } },
    });
    expect(sink.text()).not.toContain("abc123");
    expect(sink.text()).toContain("json");
  });

  it("redacts a secret inside an array", () => {
    const log = loggerAt("debug");
    log.debug("keys", { candidates: [`sk-${"z".repeat(40)}`] });
    expect(sink.text()).not.toContain("z".repeat(40));
  });

  it("cannot be relaxed by a binding either", () => {
    // `child()` bindings are attacker-shaped in the same way a context object
    // is: they are merged into every line, so they go through the same pipe.
    const log = loggerAt("debug").child({ api_key: "abc123" });
    log.info("started");
    expect(sink.text()).not.toContain("abc123");
  });

  it("never lets a context key overwrite the frame", () => {
    // A line whose `lvl` came from user-supplied context would be a line that
    // lies to whoever greps it.
    const log = loggerAt("debug");
    log.warn("odd", { lvl: "info", t: 0, msg: "not the message" });
    const line = sink.lines[0]?.line ?? "";
    expect(line).toContain('"lvl":"warn"');
    expect(line).toContain('"msg":"odd"');
    expect(line).toContain('"ctx.lvl":"info"');
  });
});

// ---------------------------------------------------------------------------
// redactContext on its own
// ---------------------------------------------------------------------------

describe("redactContext", () => {
  it.each([
    "api_key",
    "apiKey",
    "x-api-key",
    "Authorization",
    "token",
    "secret",
    "password",
    "bearer",
    "credential",
  ])("blanks the %s field whatever the value looks like", (key) => {
    expect(redactContext({ [key]: "short" })[key]).toBe("[redacted:5]");
  });

  it("passes numbers and booleans through unchanged", () => {
    expect(redactContext({ status: 429, ok: false, ms: 3_120 })).toEqual({
      status: 429,
      ok: false,
      ms: 3_120,
    });
  });

  it("does not mutate the caller's object", () => {
    const ctx = { api_key: "abc123" };
    redactContext(ctx);
    expect(ctx.api_key).toBe("abc123");
  });

  it("degrades a cycle to [cyclic] instead of hanging", () => {
    // `structuredClone` is absent from the sandbox (docs/01 §2.3), so the walk
    // cannot normalise its input first and has to survive one.
    const node: Record<string, unknown> = { name: "a" };
    node.self = node;
    expect(redactContext({ node })).toEqual({
      node: { name: "a", self: "[cyclic]" },
    });
  });

  it("stops at a depth limit", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i += 1) deep = { down: deep };
    expect(JSON.stringify(redactContext(deep))).toContain("[depth]");
  });

  it("summarizes an Error without leaking a key from its message", () => {
    const out = redactContext({
      err: new Error(`failed with sk-${"y".repeat(40)}`),
    }) as { err: { name: string; message: string } };
    expect(out.err.name).toBe("Error");
    expect(out.err.message).not.toContain("y".repeat(40));
  });

  it("replaces a function rather than trying to serialize it", () => {
    expect(redactContext({ cb: () => undefined }).cb).toBe("[function]");
  });
});

// ---------------------------------------------------------------------------
// Level gating and line format — docs/07 §10.3
// ---------------------------------------------------------------------------

describe("level gating (docs/07 §10.3, §8.5)", () => {
  it('defaults to the pref default "warn"', () => {
    expect(DEFAULT_LOG_LEVEL).toBe("warn");
    const log = createLogger({ sink, clock });
    log.error("a");
    log.warn("b");
    log.info("c");
    log.debug("d");
    expect(sink.lines).toHaveLength(2);
  });

  it.each([
    ["error", 1],
    ["warn", 2],
    ["info", 3],
    ["debug", 4],
  ] as const)("at level %s emits %i of the four calls", (level, expected) => {
    const log = loggerAt(level);
    log.error("a");
    log.warn("b");
    log.info("c");
    log.debug("d");
    expect(sink.lines).toHaveLength(expected);
  });

  it("maps our levels onto Zotero's numeric levels (error 1 … debug 4)", () => {
    // §10.3: "Lower level = more severe, default 3."
    const log = loggerAt("debug");
    log.error("a");
    log.warn("b");
    log.info("c");
    log.debug("d");
    expect(sink.lines.map((l) => l.zoteroLevel)).toEqual([1, 2, 3, 4]);
  });

  it("follows a level that changes after construction", () => {
    // §8.5: docs/08 §7.3's "Verbose debug logging" checkbox writes `logLevel`
    // live, so a logger holding a stale copy would ignore the user's click.
    let level: LogLevel = "warn";
    const log = createLogger({ sink, clock, level: () => level });
    log.debug("hidden");
    level = "debug";
    log.debug("shown");
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.line).toContain("shown");
  });

  it("gives a child the parent's live level, not a snapshot", () => {
    let level: LogLevel = "warn";
    const child = createLogger({ sink, clock, level: () => level }).child({
      jobId: "a1b2",
    });
    child.debug("hidden");
    level = "debug";
    child.debug("shown");
    expect(sink.lines).toHaveLength(1);
  });

  it("routes error() to the second channel §10.3 requires", () => {
    // "Logger.error() additionally calls Zotero.logError() so the entry reaches
    // the Mozilla error console and Zotero.getErrors()."
    const log = loggerAt("debug");
    log.error("broke");
    log.warn("did not break");
    expect(sink.reported).toHaveLength(1);
    expect(sink.reported[0]).toContain("broke");
  });

  it("works against a sink with no second channel", () => {
    const bare: LogSink = { write: vi.fn() };
    const log = createLogger({ sink: bare, clock, level: "debug" });
    expect(() => log.error("broke")).not.toThrow();
  });
});

describe("line format (docs/07 §10.3)", () => {
  it("carries the greppable prefix and a single-line JSON payload", () => {
    const log = createLogger({
      sink,
      clock,
      level: "info",
      bindings: { jobId: "a1b2", pipeline: "summarize" },
    }).child({ stage: "llm" });
    log.info("chat completed", { model: "gpt-4o-mini", inTok: 2411 });

    const line = sink.lines[0]?.line ?? "";
    expect(line.startsWith(`${LOG_PREFIX} `)).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice(LOG_PREFIX.length + 1))).toEqual({
      t: 1_757_300_000_000,
      lvl: "info",
      jobId: "a1b2",
      pipeline: "summarize",
      stage: "llm",
      msg: "chat completed",
      model: "gpt-4o-mini",
      inTok: 2411,
    });
  });

  it("keeps one line per entry when the message spans lines", () => {
    const log = loggerAt("debug");
    log.debug("first\nsecond");
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.line).not.toContain("\n");
  });

  it("stamps t from the injected clock, never from Date.now", () => {
    // docs/01 §2.3: `performance` is absent from the sandbox, so every duration
    // goes through the Clock port; that is also what makes this assertion exact.
    const log = loggerAt("debug");
    clock.setNow(42);
    log.debug("a");
    expect(sink.lines[0]?.line).toContain('"t":42');
  });
});

describe("time()", () => {
  it("logs a duration and the ok outcome, and returns the value", async () => {
    const log = loggerAt("debug");
    const value = await log.time("fetch", async () => {
      clock.advance(120);
      return 7;
    });
    expect(value).toBe(7);
    expect(sink.lines[0]?.line).toContain('"ms":120');
    expect(sink.lines[0]?.line).toContain('"outcome":"ok"');
  });

  it("logs the failed outcome and rethrows", async () => {
    const log = loggerAt("debug");
    await expect(
      log.time("fetch", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(sink.lines[0]?.line).toContain('"outcome":"failed"');
    expect(sink.lines[0]?.zoteroLevel).toBe(2);
  });

  it("redacts a key that reached the thrown error's message", async () => {
    const log = loggerAt("debug");
    const secret = `sk-${"q".repeat(40)}`;
    await expect(
      log.time("fetch", () => Promise.reject(new Error(`sent ${secret}`))),
    ).rejects.toThrow();
    expect(sink.text()).not.toContain(secret);
  });
});

describe("NULL_LOG_SINK", () => {
  it("discards without breaking the logger", () => {
    const log = createLogger({ sink: NULL_LOG_SINK, clock, level: "debug" });
    expect(() => log.debug("a", { api_key: "abc123" })).not.toThrow();
  });
});

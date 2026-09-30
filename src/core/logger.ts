/**
 * Structured logging with unconditional redaction.
 *
 * **Scope.** `P1-T02`. The {@link Logger} contract of `docs/07` §10.3, its line
 * format, its level gating, and the redaction §10.3 and
 * `docs/09-security-privacy-and-api-keys.md` §2.1 require at the logger.
 * §10.4's 5000-line ring buffer and the debug bundle that reads it are a
 * separate surface with a separate owner and are not built here.
 *
 * **Authority.** {@link LogLevel} and {@link Logger} are `docs/07` §10.3's,
 * verbatim. The `logLevel` pref's four values and its `"warn"` default are
 * §8.5's Diagnostics row. The redaction patterns are `docs/09` §2.1's and are
 * imported from `./errors` — §10.3 requires they "must not be duplicated with
 * drift; `src/core/logger.ts` imports them from one place", and `./errors`'s
 * header records why that place is `src/core/errors.ts`.
 *
 * ## Why the sink is a port
 *
 * §10.3 says every line is emitted through `Zotero.debug()`, with
 * `Logger.error()` additionally calling `Zotero.logError()` so the entry reaches
 * the Mozilla error console and `Zotero.getErrors()`. But `docs/07` §2.3 makes
 * `src/zotero/` the only directory allowed to name the global and
 * `eslint.config.js` enforces it with `no-restricted-globals`, so this module
 * declares {@link LogSink} and the composition root supplies the adapter.
 * `P1-T02`'s step 5 asks for exactly that. It is also what makes
 * `logger-redaction.test.ts` an assertion about emitted *text* rather than about
 * a spy on a global.
 *
 * ## Redaction is not a policy, it is the pipe
 *
 * `docs/10` FR-54, `docs/07` §10.3 and `docs/09` §2.1 all say the same thing
 * three ways: **no preference relaxes this.** {@link redactMessage} and
 * {@link redactContext} run on every message and every context value at every
 * level, before {@link LogSink.write} is ever reached, and there is no code path
 * through this file that emits an unredacted value. Raising `logLevel` to
 * `debug` widens *which* lines are emitted; `logRequestBodies` widens *what
 * content* may be put in a context object. Neither can widen credentials,
 * because neither is consulted here. `P1-T02`'s **Do NOT** names making
 * redaction conditional on either as the defect this design forecloses.
 */

import type { Clock } from "./clock";
import { KEYISH_FIELD, redact, redactUrl } from "./errors";

// ---------------------------------------------------------------------------
// 1. The contract — docs/07 §10.3, verbatim
// ---------------------------------------------------------------------------

/** The four values of the `logLevel` preference (§8.5, Diagnostics), in severity order. */
export type LogLevel = "error" | "warn" | "info" | "debug";

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  error(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  /** Times an operation and logs duration + outcome. */
  time<T>(
    msg: string,
    fn: () => Promise<T>,
    ctx?: Record<string, unknown>,
  ): Promise<T>;
}

// ---------------------------------------------------------------------------
// 2. Level mapping — docs/07 §10.3
// ---------------------------------------------------------------------------

/**
 * `docs/07` §10.3: "Our `LogLevel` maps onto Zotero's numeric levels as:
 * `error → 1`, `warn → 2`, `info → 3`, `debug → 4`." **Lower level = more
 * severe**, which is why this table is also the gating order — a logger set to
 * `warn` emits everything whose number is ≤ 2.
 */
const ZOTERO_LEVEL: Readonly<Record<LogLevel, 1 | 2 | 3 | 4>> = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** The `logLevel` pref's shipped default (`docs/07` §8.5, Diagnostics). */
export const DEFAULT_LOG_LEVEL: LogLevel = "warn";

/** `docs/07` §10.3's fixed prefix, which makes a line greppable in a debug log. */
export const LOG_PREFIX = "[research_helper]";

// ---------------------------------------------------------------------------
// 3. The sink port
// ---------------------------------------------------------------------------

/**
 * Where a finished, redacted line goes. `Zotero.debug` / `Zotero.logError`
 * behind §2.3's dependency rule.
 *
 * The signature mirrors §10.3's verified one, `Zotero.debug(message, level)`
 * with `level` defaulting to 3, so the adapter in `src/zotero/` is a one-line
 * forward and has nowhere to add policy.
 */
export interface LogSink {
  /**
   * Emit one line. `zoteroLevel` is 1–4 per {@link ZOTERO_LEVEL}; pass it
   * straight through as `Zotero.debug`'s second argument.
   */
  write(line: string, zoteroLevel: 1 | 2 | 3 | 4): void;
  /**
   * Additionally route an `error()` line to `Zotero.logError()`, so it reaches
   * the Mozilla error console and `Zotero.getErrors()` (§10.3). Optional: a test
   * sink and the dev-time `dump()` sink have no second channel.
   */
  reportError?(line: string): void;
}

// ---------------------------------------------------------------------------
// 4. Redaction
// ---------------------------------------------------------------------------

/** How deep {@link redactContext} walks before it stops. */
const MAX_CONTEXT_DEPTH = 6;

/** Anything with a scheme and an authority is treated as a URL. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Redact a log message.
 *
 * A URL-shaped message goes through {@link redactUrl} first, because §10.3's
 * URL rule strips parameters `redact()` alone cannot see: a short key such as
 * `?api_key=abc123` matches none of `docs/09` §2.1's `KEY_PATTERNS` and is
 * removed only by the parameter rule.
 */
function redactMessage(msg: string): string {
  return ABSOLUTE_URL.test(msg.trim()) ? redactUrl(msg) : redact(msg);
}

/**
 * Redact one context value, by its key and by its shape.
 *
 * The order of the three rules is the order §10.3 states them:
 *
 * 1. **Key-based.** A key matching {@link KEYISH_FIELD} makes the value
 *    `[redacted:<len>]` whatever it is. This is the rule that covers the
 *    `Authorization` and `x-api-key` headers §10.3 says are "never logged, at
 *    any level", and it covers a *short* key — the one case no content pattern
 *    can catch.
 * 2. **URL-based.** A string that looks like an absolute URL goes through
 *    {@link redactUrl}, which drops `key`, `api_key`, `apikey`, `token` and
 *    `access_token`.
 * 3. **Content-based.** Every other string goes through {@link redact}.
 *
 * Containers are walked, because a credential one level down is still a
 * credential. The walk is bounded by {@link MAX_CONTEXT_DEPTH} and by a
 * seen-set: a cycle in a context object must degrade to `"[cyclic]"`, not hang
 * the logger — and `structuredClone` is not available in the sandbox
 * (`docs/01` §2.3) to normalise the input first.
 */
function redactValue(
  key: string | undefined,
  value: unknown,
  depth: number,
  seen: Set<object>,
): unknown {
  if (key !== undefined && KEYISH_FIELD.test(key)) {
    // `String(value)` and not `JSON.stringify`: a `Secret` (docs/09 §2.1)
    // stringifies to "[Secret]", so the reported length would describe the
    // placeholder. Either way no value reaches the log; the length is a hint.
    return `[redacted:${String(value ?? "").length}]`;
  }
  if (typeof value === "string") {
    return ABSOLUTE_URL.test(value.trim()) ? redactUrl(value) : redact(value);
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return redact(String(value));
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (depth >= MAX_CONTEXT_DEPTH) return "[depth]";
  if (seen.has(value as object)) return "[cyclic]";
  seen.add(value as object);
  try {
    if (Array.isArray(value)) {
      return value.map((v) => redactValue(undefined, v, depth + 1, seen));
    }
    if (value instanceof Error) {
      // Not spread: an Error's own enumerable properties are usually empty and
      // the interesting parts are non-enumerable.
      return {
        name: value.name,
        message: redact(value.message),
        ...(value.stack !== undefined && { stack: redact(value.stack) }),
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

/**
 * Redact a whole context object.
 *
 * @param ctx - the caller's structured context, unredacted
 * @returns a new object; the caller's is never mutated
 */
export function redactContext(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const seen = new Set<object>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = redactValue(k, v, 0, seen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. The logger
// ---------------------------------------------------------------------------

/** What {@link createLogger} needs. */
export interface LoggerOptions {
  /** Where lines go. `Zotero.debug` behind a `src/zotero/` adapter. */
  readonly sink: LogSink;
  /** Supplies the `t` field and `time()`'s duration. */
  readonly clock: Clock;
  /**
   * The `logLevel` pref (`docs/07` §8.5).
   *
   * A function is accepted as well as a value because §8.5 reads `logLevel` at
   * startup but the pane's "Verbose debug logging" checkbox (`docs/08` §7.3)
   * writes it live; a getter lets `P1-T03` wire `observePref` without this
   * module holding a stale copy. Defaults to {@link DEFAULT_LOG_LEVEL}.
   */
  readonly level?: LogLevel | (() => LogLevel);
  /** Fields merged into every line. Usually empty at the root. */
  readonly bindings?: Record<string, unknown>;
}

/**
 * Build a logger.
 *
 * The emitted line is §10.3's, field for field:
 *
 * ```
 * [research_helper] {"t":1757300000000,"lvl":"info","jobId":"a1b2",
 *  "pipeline":"summarize","stage":"llm","msg":"chat completed", … }
 * ```
 *
 * `t` then `lvl` then the bindings then `msg` then the call's context — which is
 * the order §10.3's example prints, and the order that makes a grep for
 * `"lvl":"error"` cheap. A context key colliding with `t`, `lvl` or `msg` is
 * emitted under `ctx.<key>` rather than silently overwriting the frame; a line
 * whose `lvl` came from user-supplied context would be a line that lies.
 *
 * The payload is one line. `JSON.stringify` with no spacing gives that, and any
 * embedded newline inside a string value is escaped by `JSON.stringify` itself,
 * so a multi-line message cannot break the one-line-per-entry contract a debug
 * log is grepped under.
 *
 * @param options - see {@link LoggerOptions}
 * @returns a {@link Logger}; call `child()` to add bindings
 */
export function createLogger(options: LoggerOptions): Logger {
  const { sink, clock } = options;
  const level = options.level ?? DEFAULT_LOG_LEVEL;
  const getLevel = typeof level === "function" ? level : () => level;
  const bindings = { ...options.bindings };

  const RESERVED = new Set(["t", "lvl", "msg"]);

  function emit(
    at: LogLevel,
    msg: string,
    ctx: Record<string, unknown> | undefined,
  ): void {
    if (ZOTERO_LEVEL[at] > ZOTERO_LEVEL[getLevel()]) return;

    const payload: Record<string, unknown> = {
      t: clock.now(),
      lvl: at,
      ...redactContext(bindings),
      msg: redactMessage(msg),
    };
    if (ctx !== undefined) {
      for (const [k, v] of Object.entries(redactContext(ctx))) {
        if (RESERVED.has(k)) payload[`ctx.${k}`] = v;
        else payload[k] = v;
      }
    }

    const line = `${LOG_PREFIX} ${JSON.stringify(payload)}`;
    sink.write(line, ZOTERO_LEVEL[at]);
    // §10.3: "`Logger.error()` additionally calls `Zotero.logError()` so the
    // entry reaches the Mozilla error console and `Zotero.getErrors()`."
    if (at === "error") sink.reportError?.(line);
  }

  const logger: Logger = {
    child(extra: Record<string, unknown>): Logger {
      return createLogger({
        sink,
        clock,
        // The getter, not its current value: a child must follow a live level
        // change like its parent does.
        level: getLevel,
        bindings: { ...bindings, ...extra },
      });
    },
    error(msg, ctx) {
      emit("error", msg, ctx);
    },
    warn(msg, ctx) {
      emit("warn", msg, ctx);
    },
    info(msg, ctx) {
      emit("info", msg, ctx);
    },
    debug(msg, ctx) {
      emit("debug", msg, ctx);
    },
    async time<T>(
      msg: string,
      fn: () => Promise<T>,
      ctx?: Record<string, unknown>,
    ): Promise<T> {
      // `clock.now()`, so this is `Date.now()` in the product: `performance`
      // is not in the sandbox (docs/01 §2.3) and every NFR duration is measured
      // with the wall clock.
      const startedMs = clock.now();
      try {
        const value = await fn();
        emit("debug", msg, {
          ...ctx,
          ms: clock.now() - startedMs,
          outcome: "ok",
        });
        return value;
      } catch (e) {
        // The failure is logged at `warn` and rethrown: whoever catches it owns
        // the user-facing decision (§10.2), and a `time()` that swallowed the
        // error would hide it behind a duration.
        emit("warn", msg, {
          ...ctx,
          ms: clock.now() - startedMs,
          outcome: "failed",
          err: e,
        });
        throw e;
      }
    },
  };

  return logger;
}

/**
 * A sink that discards everything.
 *
 * For a `core/` object constructed before the container has wired the real sink,
 * and for tests that are not about logging. It is not a no-op *logger*: level
 * gating and redaction still run, so a test cannot accidentally pass because the
 * pipe was dead.
 */
export const NULL_LOG_SINK: LogSink = {
  write(): void {
    /* discard */
  },
};

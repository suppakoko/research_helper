/**
 * `Result<T, E>` — the explicit-failure return type for adapter boundaries.
 *
 * **Scope.** `P1-T02`. `docs/07` §2.2 is the whole of the specification: this
 * file holds "`Result<T, E>` helpers for adapter boundaries". Nothing else in
 * the corpus declares the type, names a member of it, or shows a call site, and
 * `P1-T02`'s six numbered **Do** steps do not mention it — only its `Files` row
 * does. So the surface below is deliberately small and conservative: the
 * discriminated union, the two constructors, the two guards, and the four
 * combinators a call site cannot write more clearly inline. Reported against the
 * card rather than guessed wider.
 *
 * **When to use it, and when not to.** Throwing is the default in this codebase:
 * `docs/07` §10.1's hierarchy exists precisely so that a failure carries a
 * `code`, a `messageKey` and a `retryable` flag up to §10.2's audience split,
 * and a `Result` that is unwrapped and rethrown has bought nothing. `Result`
 * earns its place at a **boundary where a failure is one of several expected
 * outcomes the caller must tabulate rather than propagate** — §10.2's "For a
 * 200-item job, do not emit 200 popups. Individual item failures accumulate in
 * the `JobRecord`, and the job completes with `Summarized 187 of 200 papers`".
 * A per-source fan-out reporting `SourceProvenance.error` for the two sources
 * that degraded (`docs/07` §5.3) is the same shape.
 *
 * `E` defaults to {@link ResearchHelperError} because NFR-14 requires every
 * failure the user can be told about to carry a `messageKey`, and a
 * `Result<T, string>` is exactly the "bare 'An error occurred'" that requirement
 * forbids.
 */

import type { ResearchHelperError, SerializedError } from "./errors";

// ---------------------------------------------------------------------------
// 1. The type
// ---------------------------------------------------------------------------

/** A success. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** A failure. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Either a value or a typed failure.
 *
 * Discriminated on `ok`, so a `switch` or an `if` narrows both arms and
 * `docs/07` §11.1 step 3's "TypeScript will now flag every exhaustive `switch`"
 * applies to it.
 */
export type Result<T, E = ResearchHelperError> = Ok<T> | Err<E>;

// ---------------------------------------------------------------------------
// 2. Constructors and guards
// ---------------------------------------------------------------------------

/** Wrap a success. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wrap a failure. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrow to the success arm. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Narrow to the failure arm. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

// ---------------------------------------------------------------------------
// 3. Combinators
// ---------------------------------------------------------------------------

/** Transform the value, leaving a failure untouched. */
export function mapOk<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transform the failure, leaving a value untouched. */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** The value, or `fallback` if this is a failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * The value, or throw the failure.
 *
 * The escape hatch back into `throw`-land, for a caller that turns out not to
 * want the failure after all. A non-`Error` `E` is wrapped so the `throw` still
 * carries a stack.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  const { error } = result;
  throw error instanceof Error ? error : new Error(String(error));
}

/**
 * Run `fn`, catching what it throws into the failure arm.
 *
 * The bridge from `docs/07` §10.1's throwing convention into a tabulating
 * caller. `classify` maps the caught value onto `E`; it is required rather than
 * defaulted, because a silent `e as E` would put an arbitrary thrown value where
 * a `messageKey` is expected and NFR-14's guarantee would hold only by luck.
 */
export async function tryCatch<T, E>(
  fn: () => Promise<T>,
  classify: (caught: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(classify(e));
  }
}

/**
 * The storable form of a failure arm, for a `JobRecord.error` or a
 * `SourceProvenance.error` field (`docs/07` §5.2, §5.3).
 *
 * Returns `undefined` for a success, which is exactly what both fields hold on a
 * clean run — §5.3: "`undefined` on a clean run".
 */
export function serializeErr<T>(
  result: Result<T, ResearchHelperError>,
): SerializedError | undefined {
  return result.ok ? undefined : result.error.toSerialized();
}

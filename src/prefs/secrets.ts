/**
 * The credential wrapper — `docs/09-security-privacy-and-api-keys.md` §2.1,
 * level 1 ("types"), verbatim.
 *
 * **Scope.** `P3-T01`. §2.1 prints this class under the file header
 * `src/prefs/secrets.ts`, so it lives here and nowhere else. Its first callers
 * are the four LLM adapters' header builders (`P3-T07`–`P3-T10`): each reads
 * the key from the store, wraps it, and calls {@link Secret.expose} exactly
 * once, inside the function that builds the `Authorization` /
 * `x-api-key` / `x-goog-api-key` header.
 *
 * **Why it is awkward on purpose.** Template interpolation, `String()`,
 * `JSON.stringify` and Node's `util.inspect` all yield `[Secret]`, so a key
 * that reaches a log line, an error context or a persisted record by accident
 * arrives as that marker rather than as key material. The only way to read the
 * value is an explicit `.expose()`, which is greppable and reviewable. This is
 * the first of §2.1's three levels; the second is the logger's unconditional
 * `redact()` (`src/core/logger.ts`) and the third is `loggableHeaders` in
 * `src/core/errors.ts`. None of the three can be switched off (§2.1: "There is
 * no diagnostic setting, and must never be one, whose effect is to put a key
 * in the log").
 *
 * **What it deliberately lacks.** No value getter, no `valueOf`, no enumerable
 * own property (the value is an ECMAScript private field, which `Object.keys`,
 * spread and `structuredClone` cannot see). Adding any of them would open a
 * second leak path that a review grep for `.expose()` would not find.
 *
 * **Why `core/` does not use it.** `docs/07` §2.3 lets `core/` import `model/`
 * only, so `src/core/errors.ts` — where the one redactor lives — cannot import
 * this file; see that file's header, "Why the redaction primitives live in this
 * file".
 */

/** A credential. Deliberately awkward to stringify. */
export class Secret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** The ONLY way to read it. Grep for this call site in review. */
  expose(): string {
    return this.#value;
  }
  toString(): string {
    return "[Secret]";
  }
  toJSON(): string {
    return "[Secret]";
  }
  get [Symbol.toStringTag](): string {
    return "Secret";
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[Secret]";
  }
}

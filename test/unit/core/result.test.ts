import { describe, expect, it, vi } from "vitest";

import {
  NetworkError,
  SourceError,
  type ResearchHelperError,
} from "../../../src/core/errors";
import {
  err,
  isErr,
  isOk,
  mapErr,
  mapOk,
  ok,
  serializeErr,
  tryCatch,
  unwrap,
  unwrapOr,
  type Result,
} from "../../../src/core/result";

/**
 * `P1-T02`. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * **What this file can and cannot assert.** `docs/07` §2.2's one-line tree
 * comment — "`result.ts` … `Result<T, E>` helpers for adapter boundaries" — is
 * the *entire* specification of this module in the corpus: no section declares
 * the type, names a member, or shows a call site. So these tests assert the
 * shipped surface's **behaviour**, not its conformance to a design section,
 * because there is no section to conform to. Where a test encodes a choice
 * rather than a requirement it says so.
 *
 * The two properties worth the most here are the ones a `Result` type exists to
 * provide and that are easiest to get wrong: that the pass-through arm of a
 * combinator is left strictly alone, and that {@link tryCatch} survives a thrown
 * **non-`Error`**.
 */

/** A fixture failure. Concrete, because §10.1's base class is abstract. */
function failure(message = "upstream refused"): NetworkError {
  return new NetworkError(message);
}

/**
 * Reject with an arbitrary value.
 *
 * Wrapped in a function taking `unknown` so the test can express "a callee threw
 * something that is not an `Error`" — which is not a hypothetical: a `JSON.parse`
 * deep in a provider SDK, a Gecko `Components.Exception`, and a bare
 * `Promise.reject("timeout")` all produce it, and every one of them reaches
 * `tryCatch` through the same `catch`.
 */
function rejectWith(value: unknown): Promise<never> {
  return Promise.reject(value);
}

// ---------------------------------------------------------------------------
// 1. Constructors and guards
// ---------------------------------------------------------------------------

describe("ok / err", () => {
  it("builds the success arm with exactly { ok, value }", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("builds the failure arm with exactly { ok, error }", () => {
    const e = failure();
    expect(err(e)).toEqual({ ok: false, error: e });
  });

  it("carries the error by identity, not by copy", () => {
    // A copy would lose the prototype and with it `code`, `messageKey` and
    // `toSerialized()` — the three things §10.1 exists to attach.
    const e = failure();
    expect(err(e).error).toBe(e);
  });

  it("wraps a falsy value without collapsing it into a failure", () => {
    // The classic discriminated-union bug: testing truthiness of the payload
    // instead of the `ok` tag.
    for (const value of [0, "", false, null, undefined, Number.NaN]) {
      expect(ok(value).ok).toBe(true);
      expect(isOk(ok(value))).toBe(true);
    }
  });
});

describe("isOk / isErr", () => {
  it("agrees with the tag on both arms", () => {
    const good: Result<number, NetworkError> = ok(1);
    const bad: Result<number, NetworkError> = err(failure());
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it("narrows both arms for the compiler", () => {
    // The real assertion here is that this file typechecks: `result.value` and
    // `result.error` are only reachable after the guard. `npm run typecheck` is
    // what proves the predicate signatures work; the runtime expects below just
    // stop the block being dead code.
    const results: Result<number, NetworkError>[] = [ok(7), err(failure())];
    const values: number[] = [];
    const codes: string[] = [];
    for (const result of results) {
      if (isOk(result)) values.push(result.value);
      if (isErr(result)) codes.push(result.error.code);
    }
    expect(values).toEqual([7]);
    expect(codes).toEqual(["NETWORK"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Combinators — both arms of each
// ---------------------------------------------------------------------------

describe("mapOk", () => {
  it("transforms the value", () => {
    expect(mapOk(ok(21), (n: number) => n * 2)).toEqual({
      ok: true,
      value: 42,
    });
  });

  it("changes the value's type", () => {
    expect(mapOk(ok(42), (n: number) => `n=${n}`)).toEqual({
      ok: true,
      value: "n=42",
    });
  });

  it("does not call the mapper on a failure", () => {
    const fn = vi.fn((n: number) => n * 2);
    const bad: Result<number, NetworkError> = err(failure());
    mapOk(bad, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the very same object on the failure arm", () => {
    // Identity, not deep equality. A rebuilt `err()` would be indistinguishable
    // by `toEqual` while quietly dropping any future field on the arm.
    const bad: Result<number, NetworkError> = err(failure());
    expect(mapOk(bad, (n: number) => n * 2)).toBe(bad);
  });

  it("propagates a throw from the mapper rather than catching it", () => {
    // `mapOk` is not a `try`. A mapper that throws is a bug in the mapper, and
    // swallowing it into the failure arm would give it a `messageKey` it has no
    // right to (NFR-14).
    expect(() =>
      mapOk(ok(1), () => {
        throw failure("mapper is broken");
      }),
    ).toThrow(NetworkError);
  });
});

describe("mapErr", () => {
  it("transforms the failure", () => {
    const bad: Result<number, NetworkError> = err(failure());
    expect(mapErr(bad, (e) => e.code)).toEqual({ ok: false, error: "NETWORK" });
  });

  it("re-classifies one §10.1 arm as another", () => {
    // The intended use: an adapter turning a transport failure into its own
    // SourceError so the provenance record names the source (§5.3).
    const bad: Result<number, NetworkError> = err(failure());
    const reclassified = mapErr(
      bad,
      (e) => new SourceError("pubmed", e.message),
    );
    expect(isErr(reclassified)).toBe(true);
    if (isErr(reclassified)) {
      expect(reclassified.error.code).toBe("SOURCE");
      expect(reclassified.error.sourceId).toBe("pubmed");
    }
  });

  it("does not call the mapper on a success", () => {
    const fn = vi.fn((e: NetworkError) => e.code);
    mapErr(ok(1) as Result<number, NetworkError>, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the very same object on the success arm", () => {
    const good: Result<number, NetworkError> = ok(1);
    expect(mapErr(good, (e: NetworkError) => e.code)).toBe(good);
  });
});

describe("unwrapOr", () => {
  it("returns the value on a success", () => {
    expect(unwrapOr(ok(42) as Result<number, NetworkError>, 0)).toBe(42);
  });

  it("returns the fallback on a failure", () => {
    expect(unwrapOr(err(failure()) as Result<number, NetworkError>, 0)).toBe(0);
  });

  it("returns a falsy value rather than the fallback", () => {
    // `result.value ?? fallback` would be wrong here, and `||` doubly so.
    expect(unwrapOr(ok(0) as Result<number, NetworkError>, 99)).toBe(0);
    expect(unwrapOr(ok("") as Result<string, NetworkError>, "x")).toBe("");
  });
});

describe("unwrap", () => {
  it("returns the value on a success", () => {
    expect(unwrap(ok(42) as Result<number, NetworkError>)).toBe(42);
  });

  it("throws the stored error itself, by identity", () => {
    // Identity matters: whoever catches this must still see §10.1's `code`,
    // `messageKey` and `retryable`, and §10.2 routes on exactly those.
    const e = failure();
    let thrown: unknown;
    try {
      unwrap(err(e) as Result<number, NetworkError>);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(e);
  });

  it.each([
    ["a string", "timeout"],
    ["a number", 503],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { detail: "nope" }],
  ])(
    "wraps %s failure arm in an Error so the throw carries a stack",
    (_label, value) => {
      const bad = err(value) as Result<number, unknown>;
      let thrown: unknown;
      try {
        unwrap(bad);
      } catch (caught) {
        thrown = caught;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).stack).toBeDefined();
      expect((thrown as Error).message).toBe(String(value));
    },
  );
});

// ---------------------------------------------------------------------------
// 3. tryCatch — the bridge from §10.1's throwing convention
// ---------------------------------------------------------------------------

describe("tryCatch", () => {
  it("wraps a resolved value in the success arm", async () => {
    // `failure` itself is deliberately NOT passed as the classifier: its
    // parameter is `message?: string`, and under `strictFunctionTypes` a
    // `(message?: string) => …` is not assignable to `(caught: unknown) => …`.
    // The compiler is right, and that contravariance is the whole point of
    // `classify` taking `unknown` — see the non-Error cases below.
    await expect(
      tryCatch(
        () => Promise.resolve(42),
        () => failure(),
      ),
    ).resolves.toEqual({ ok: true, value: 42 });
  });

  it("does not call classify on success", async () => {
    const classify = vi.fn(() => failure());
    await tryCatch(() => Promise.resolve(1), classify);
    expect(classify).not.toHaveBeenCalled();
  });

  it("routes a rejected Error through classify", async () => {
    // The intended use: an adapter re-classifying a transport failure as its own
    // SourceError, keeping the original as `cause` so §10.2's developer column
    // still has it.
    const transport = failure("refused");
    const result = await tryCatch(
      () => rejectWith(transport),
      (caught) =>
        new SourceError("pubmed", "efetch failed", {}, { cause: caught }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("SOURCE");
      expect(result.error.sourceId).toBe("pubmed");
      expect(result.error.cause).toBe(transport);
    }
  });

  it("hands classify the caught value by identity", async () => {
    const cause = failure();
    const classify = vi.fn((caught: unknown) => caught as ResearchHelperError);
    await tryCatch(() => rejectWith(cause), classify);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0]?.[0]).toBe(cause);
  });

  it.each([
    ["a string", "timeout"],
    ["a number", 503],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { detail: "nope" }],
    ["an array", [1, 2]],
  ])("survives a thrown non-Error: %s", async (_label, thrown) => {
    // This is the case the module exists to make safe, and the one most likely
    // to be wrong: nothing in the corpus guarantees every rejection in a
    // provider SDK is an Error, and `catch (e) { e.message }` on a string is a
    // second failure on top of the first.
    const seen: unknown[] = [];
    const result = await tryCatch(
      () => rejectWith(thrown),
      (caught) => {
        seen.push(caught);
        return failure(`classified ${typeof caught}`);
      },
    );
    expect(isErr(result)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(thrown);
  });

  it("catches a synchronous throw from fn, not only a rejection", async () => {
    // `fn` is typed `() => Promise<T>`, but `try { await fn() }` covers a
    // callee that throws before it ever returns a promise — a non-async function
    // passed in from untyped JavaScript, for instance.
    const result = await tryCatch(
      (): Promise<number> => {
        throw failure("threw before returning");
      },
      (caught) => caught as NetworkError,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result))
      expect(result.error.message).toBe("threw before returning");
  });

  it("propagates a throw from classify itself", async () => {
    // If the classifier is broken there is no meaningful arm to return, and
    // silently substituting one would hide the bug behind a plausible error.
    await expect(
      tryCatch(
        () => rejectWith(failure()),
        () => {
          throw new Error("classifier is broken");
        },
      ),
    ).rejects.toThrow("classifier is broken");
  });
});

// ---------------------------------------------------------------------------
// 4. serializeErr — the storable form (§5.2, §5.3)
// ---------------------------------------------------------------------------

describe("serializeErr", () => {
  it("returns undefined on a success, matching §5.3's clean run", () => {
    // §5.3: `SourceProvenance.error` is "`undefined` on a clean run".
    expect(serializeErr(ok(42))).toBeUndefined();
  });

  it("returns §5.2's SerializedError on a failure", () => {
    expect(serializeErr(err(failure("bad gateway")))).toMatchObject({
      code: "NETWORK",
      messageKey: "rh-error-network",
      detail: "bad gateway",
      retryable: true,
    });
  });

  it("returns an already-redacted detail", () => {
    // The field is exported through schema/provenance.schema.json (§5.3), so a
    // key reaching it would leave the repository in a user's JSON file. The
    // redaction is errors.ts's; this asserts the path actually goes through it.
    const secret = `sk-${"z".repeat(40)}`;
    const serialized = serializeErr(err(failure(`sent ${secret}`)));
    expect(JSON.stringify(serialized)).not.toContain(secret);
    expect(serialized?.detail).toContain("[redacted:");
  });

  it("keeps httpStatus off an error that has none", () => {
    const serialized = serializeErr(err(failure()));
    expect(serialized && "httpStatus" in serialized).toBe(false);
  });
});

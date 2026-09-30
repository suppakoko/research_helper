/**
 * Cooperative cancellation — `CancellationToken`, `CancellationReason`,
 * `CancellationTokenSource`.
 *
 * **Scope.** `P1-T02`. The token and its source only. `docs/07` §4.5's
 * `JobQueue` / `JobHandle`, §7.6's persistent `JobRecord` store and the
 * scheduler that will sit beside this file in `src/core/jobQueue/` are Phase 3's
 * (`docs/11` §1), and `P1-T02`'s **Do NOT** names building them here as
 * out-of-scope work Phase 3 would rewrite.
 *
 * **Authority.** Every declaration below is transcribed from
 * `docs/07-architecture-and-data-model.md` §4.1, which `plan/README.md` §5
 * rule 3 makes the sole authority for types.
 *
 * ## Why this is a first-class plugin concept and not an `AbortController`
 *
 * `docs/07` §1.2 records that Zotero 10 removed Bluebird, so there is no
 * cancellable promise to lean on. And the platform's own answer is not
 * available either: **`AbortController` does not exist in the plugin sandbox.**
 * Measured 2026-09-10 on Zotero 10.0.1 / Gecko 140, card `P0-T08`, two
 * independent probes agreeing (`docs/01` §2.3) — referencing the name *throws*.
 *
 * That is why {@link CancellationToken.onCancelled} is the load-bearing member.
 * `docs/07` §7.4 checks cancellation in four places, and the one that reaches
 * the network is `Zotero.HTTP.request`'s **`cancellerReceiver`** — "*not* an
 * `AbortSignal`, which does not exist in the plugin sandbox". `P0-T17` measured
 * that path end to end and `src/core/http/client.ts` already exposes it as
 * {@link `HttpRequestOptions.onCanceller`}; `P1-T05` drives it from
 * `onCancelled`, exactly as §7.4's excerpt shows.
 *
 * ## So what is `signal`?
 *
 * §4.1 declares `readonly signal: AbortSignal` and §7.4 explains why it stays:
 * "`token.signal` remains on the interface for adapters that use `fetch`-shaped
 * APIs, but the Zotero path uses `cancellerReceiver`." `fetch` *is* in the
 * sandbox's measured global set; `AbortController` is not, so in the product
 * `signal` is interop surface that nothing can currently consume — which is
 * precisely the "`signal` member becomes decoration" outcome `P1-T02`'s
 * **Notes** anticipates.
 *
 * `P1-T02` step 1 says to back it with "an internal `AbortController` so
 * `token.signal` is real". Taken literally that is a module-load-time throw in
 * the product. It is honoured where it can be: {@link
 * createCancellationTokenSource} uses a real `AbortController` when one exists
 * — which it does under `vitest`, so the acceptance criterion
 * "`token.signal.aborted` becomes `true` when `cancel()` is called" is asserted
 * against the genuine platform type — and falls back to {@link
 * createSignalShim}, a minimal same-shape object, where it does not. Both
 * satisfy §4.1's declared member; neither throws. The divergence is reported
 * against the card rather than coded around silently.
 */

import { OperationCancelledError } from "../errors";

// ---------------------------------------------------------------------------
// 1. The interfaces — docs/07 §4.1, verbatim
// ---------------------------------------------------------------------------

/** Cooperative cancellation. Modelled on AbortSignal but decoupled from DOM. */
export interface CancellationToken {
  /** True once cancellation has been requested. */
  readonly isCancellationRequested: boolean;
  /** Why cancellation happened: user action, shutdown, budget, or timeout. */
  readonly reason: CancellationReason | undefined;
  /** Throws OperationCancelledError if cancellation was requested. */
  throwIfCancelled(): void;
  /** Register a callback; returns an unsubscribe function. */
  onCancelled(cb: (reason: CancellationReason) => void): () => void;
  /** Interop with fetch/XHR-style APIs. */
  readonly signal: AbortSignal;
}

export type CancellationReason =
  | { kind: "user" }
  | { kind: "shutdown" }
  | {
      kind: "budget-exceeded";
      limit: number;
      unit: "usd" | "tokens" | "requests";
    }
  | { kind: "timeout"; ms: number }
  | { kind: "dependency-failed"; jobId: string };

export interface CancellationTokenSource {
  readonly token: CancellationToken;
  cancel(reason: CancellationReason): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// 2. The `AbortSignal` backing
// ---------------------------------------------------------------------------

/**
 * The two operations a token needs from whatever provides its `signal`.
 *
 * Splitting it out is what lets the sandbox and Node paths differ in one place
 * instead of throughout {@link createCancellationTokenSource}.
 */
interface SignalBacking {
  readonly signal: AbortSignal;
  abort(): void;
}

/**
 * A minimal stand-in for `AbortSignal`, for the plugin sandbox, where
 * `AbortController` is absent (`docs/01` §2.3).
 *
 * It implements the members a consumer actually reads — `aborted`, `reason`,
 * `onabort`, `addEventListener` / `removeEventListener`, `throwIfAborted` — and
 * is cast to `AbortSignal` because the real type extends `EventTarget`, whose
 * full contract (capture phases, `AbortSignal.any`, `dispatchEvent` semantics)
 * cannot be met without the platform class and which no caller in this codebase
 * uses. The cast is the honest shape of the situation: in the sandbox there is
 * no `AbortSignal` to be, and §7.4 already says nothing on the Zotero path
 * consumes this member.
 */
function createSignalShim(): SignalBacking {
  const listeners = new Set<(event: { type: "abort" }) => void>();
  const shim = {
    aborted: false,
    reason: undefined as unknown,
    onabort: null as ((event: { type: "abort" }) => void) | null,
    addEventListener(type: string, cb: (event: { type: "abort" }) => void) {
      if (type === "abort") listeners.add(cb);
    },
    removeEventListener(type: string, cb: (event: { type: "abort" }) => void) {
      if (type === "abort") listeners.delete(cb);
    },
    dispatchEvent(): boolean {
      return true;
    },
    throwIfAborted(): void {
      if (shim.aborted) throw shim.reason;
    },
  };

  return {
    signal: shim as unknown as AbortSignal,
    abort(): void {
      if (shim.aborted) return;
      shim.aborted = true;
      // The real AbortSignal's default reason is a DOMException; that class is
      // not in the sandbox's measured global set either, so an Error stands in.
      shim.reason = new Error("Aborted");
      const event = { type: "abort" } as const;
      shim.onabort?.(event);
      for (const cb of [...listeners]) cb(event);
      listeners.clear();
    },
  };
}

/**
 * A real `AbortController` when the runtime has one (Node, and therefore every
 * `vitest` layer-1 test), the shim otherwise (the plugin sandbox).
 *
 * The `typeof` guard is deliberately on the bare identifier rather than on
 * `globalThis.AbortController`: `docs/01` §2.3's probe established that both
 * forms agree in the sandbox, and `typeof` on an undeclared identifier is the
 * one reference form that does not throw.
 */
function createSignalBacking(): SignalBacking {
  if (typeof AbortController === "function") {
    const controller = new AbortController();
    return { signal: controller.signal, abort: () => controller.abort() };
  }
  return createSignalShim();
}

// ---------------------------------------------------------------------------
// 3. The source
// ---------------------------------------------------------------------------

/**
 * Create a cancellation token and the handle that cancels it.
 *
 * `cancel()` is idempotent — the first reason wins, later calls are ignored —
 * because §7.4's shutdown path signals every running job with
 * `{ kind: "shutdown" }` and a job that had already been cancelled by the user
 * must keep the reason the UI is about to explain.
 *
 * Callbacks are invoked **synchronously** inside `cancel()`. That is what makes
 * the four §7.4 check points responsive without a microtask hop, and it matters
 * doubly here because `queueMicrotask` is not in the sandbox either
 * (`docs/01` §2.3). A throwing callback must not stop the others or leave
 * `cancel()` half-done, so each is called in its own `try`; there is no
 * `console` in the sandbox to report into, so a throw is swallowed. Subscribers
 * that need their failure recorded log it themselves.
 *
 * @returns the source; read `.token` to pass cancellation down a call chain
 */
export function createCancellationTokenSource(): CancellationTokenSource {
  const backing = createSignalBacking();
  const listeners = new Set<(reason: CancellationReason) => void>();
  let reason: CancellationReason | undefined;
  let disposed = false;

  const token: CancellationToken = {
    get isCancellationRequested(): boolean {
      return reason !== undefined;
    },
    get reason(): CancellationReason | undefined {
      return reason;
    },
    throwIfCancelled(): void {
      // The reason is handed over, not copied: `P1-T02` step 2 requires the
      // same object, so a caller can compare identity with what it passed to
      // `cancel()`.
      if (reason !== undefined) throw new OperationCancelledError(reason);
    },
    onCancelled(cb: (reason: CancellationReason) => void): () => void {
      // Subscribing after the fact still fires: a request that started while
      // the token was already cancelled must be aborted, which is the
      // `if (opts.token?.isCancellationRequested) c()` line in §7.4's excerpt
      // expressed once, here, instead of at every call site.
      if (reason !== undefined) {
        cb(reason);
        return () => undefined;
      }
      if (disposed) return () => undefined;
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    get signal(): AbortSignal {
      return backing.signal;
    },
  };

  return {
    token,
    cancel(next: CancellationReason): void {
      if (reason !== undefined || disposed) return;
      reason = next;
      backing.abort();
      const pending = [...listeners];
      listeners.clear();
      for (const cb of pending) {
        try {
          cb(next);
        } catch {
          /* a subscriber's failure is its own; cancellation still completed */
        }
      }
    },
    dispose(): void {
      // Drops subscriptions so a finished job's closures stop referencing it
      // (`docs/01` §12 gotcha 10). It does not cancel: disposing a token whose
      // work succeeded must not make that work look cancelled.
      disposed = true;
      listeners.clear();
    },
  };
}

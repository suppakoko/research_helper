/* eslint-disable no-restricted-globals -- the integration suite's setup: it doubles Zotero.HTTP.request for one service (docs/13 §2.3), and there is no src/zotero/ facade for that from outside the plugin bundle. */
/**
 * The suite's guard against a live request (`plan/00` §6 item 347(c), added
 * 2026-11-05).
 *
 * **Why it exists.** Before this file the suite had two guards: the
 * `Zotero.Translate.Search` stub (`./translateSearchGuard.ts`), and the channel
 * recorders that `phase1-dod.spec.ts` and `summarySection.spec.ts` hold open around
 * one body each. Neither sees a real related window, which starts its own run when
 * it opens (`P5-T16`), through `Zotero.HTTP`. A spec that forgets to double a source
 * would have sent real requests and passed.
 *
 * **What it does.** `http-on-modify-request` fires before a channel connects. For
 * every request {@link isLiveRequest} says is live, the observer **cancels the
 * channel**, so nothing leaves the machine, and records an incident, which the root
 * `afterEach` in `../_suite-guards.spec.ts` turns into a failure. It also keeps the
 * hosts it saw and let through, for the run's log, so a clean run says what it read.
 *
 * **Bundles.** Every spec is its own bundle with its own copy of this module, so the
 * state is on `globalThis`, as in `./translateSearchGuard.ts`. Only
 * {@link isLiveRequest} is pure, and `test/unit/integration/liveRequests.test.ts`
 * tests it in Node.
 */

import {
  hostOf,
  isPluginRequest,
  type ObservedRequest,
} from "./startupRequests";

/** Hosts a test may reach, with or without the plugin's `User-Agent`. */
const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/**
 * The services this plugin talks to: no test may reach them, whatever the
 * `User-Agent`. The plugin's own requests are caught by their `User-Agent` on any
 * host; this list is for a request sent some other way, such as a translator's.
 */
export const LIVE_SERVICE_HOSTS: readonly string[] = [
  "eutils.ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "api.semanticscholar.org",
  "www.ebi.ac.uk",
  "api.crossref.org",
  "export.arxiv.org",
  "api.biorxiv.org",
  "api.openalex.org",
  "openrouter.ai",
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
];

/** A host without its port: `127.0.0.1:9` and `[::1]:9` compare as their addresses. */
function withoutPort(host: string): string {
  return host.replace(/:\d+$/u, "");
}

/**
 * Whether a request must not happen during a test run: the plugin's `User-Agent`
 * anywhere but loopback (`phase1-dod.spec.ts`'s recorder check uses a closed
 * loopback port), or a host on {@link LIVE_SERVICE_HOSTS}.
 *
 * @param request - what the observer read off the channel
 * @returns true when the request is to be cancelled and reported
 */
export function isLiveRequest(request: ObservedRequest): boolean {
  const host = withoutPort(hostOf(request.url));
  if (LOOPBACK_HOSTS.includes(host)) return false;
  return isPluginRequest(request) || LIVE_SERVICE_HOSTS.includes(host);
}

const GUARD_STATE = Symbol.for("research_helper.liveRequestGuard");

interface GuardState {
  readonly observer: { observe(subject: unknown): void };
  incidents: string[];
  currentTest: string;
  /** Every host seen and let through, for the run's log. */
  readonly passedHosts: Set<string>;
  /** Each address away from loopback it let through, and the test it came in. */
  readonly passedAway: Set<string>;
  /** How many channels the observer read. */
  channels: number;
}

/** The slice of an `nsIHttpChannel` this reads. */
interface ObservedChannel {
  readonly URI?: { readonly spec?: string };
  getRequestHeader?(name: string): string;
  cancel?(status: number): void;
}

function globalState(): GuardState | undefined {
  return (globalThis as Record<symbol, GuardState | undefined>)[GUARD_STATE];
}

function httpChannel(subject: unknown): ObservedChannel {
  const queryInterface = (subject as { QueryInterface?: unknown })
    .QueryInterface;
  if (typeof queryInterface !== "function") return subject as ObservedChannel;
  try {
    return (queryInterface as (iid: unknown) => unknown).call(
      subject,
      Components.interfaces.nsIHttpChannel,
    ) as ObservedChannel;
  } catch {
    return subject as ObservedChannel;
  }
}

/** The channel's `User-Agent`, or `undefined` when it has none to read. */
function userAgentOf(channel: ObservedChannel): string | undefined {
  try {
    return channel.getRequestHeader?.("User-Agent");
  } catch {
    return undefined;
  }
}

/** The address with no query, so a key in a URL can never reach the log. */
function withoutQuery(url: string): string {
  return url.split(/[?#]/u, 1)[0] ?? "";
}

/** Start watching. Idempotent, and safe to call from every bundle. */
export function installLiveRequestGuard(): void {
  if (globalState() !== undefined) return;
  const state: GuardState = {
    incidents: [],
    currentTest: "(outside any test)",
    passedHosts: new Set(),
    passedAway: new Set(),
    channels: 0,
    observer: {
      observe(subject: unknown): void {
        // An observer that throws must not take the request's caller with it.
        try {
          const channel = httpChannel(subject);
          const request: ObservedRequest = {
            url: channel.URI?.spec ?? "",
            userAgent: userAgentOf(channel),
          };
          state.channels += 1;
          if (!isLiveRequest(request)) {
            const host = hostOf(request.url);
            state.passedHosts.add(host);
            if (!LOOPBACK_HOSTS.includes(withoutPort(host))) {
              state.passedAway.add(
                `${withoutQuery(request.url)} in "${state.currentTest}"`,
              );
            }
            return;
          }
          state.incidents.push(
            `"${state.currentTest}" sent a live request to ` +
              withoutQuery(request.url),
          );
          channel.cancel?.(Components.results.NS_BINDING_ABORTED);
        } catch {
          // The incident list is the report; a read that failed here is not one.
        }
      },
    },
  };
  (globalThis as Record<symbol, GuardState | undefined>)[GUARD_STATE] = state;
  Services.obs.addObserver(state.observer, "http-on-modify-request");
}

/** Stop watching, at the end of the run. */
export function uninstallLiveRequestGuard(): void {
  const state = globalState();
  if (state === undefined) return;
  Services.obs.removeObserver(state.observer, "http-on-modify-request");
  (globalThis as Record<symbol, GuardState | undefined>)[GUARD_STATE] =
    undefined;
}

/** True while the observer is registered. */
export function isLiveRequestGuardInstalled(): boolean {
  return globalState() !== undefined;
}

/** Name the running test, so an incident says where it happened. */
export function setLiveGuardTest(title: string): void {
  const state = globalState();
  if (state !== undefined) state.currentTest = title;
}

/** The incidents since the last call, which are then cleared. */
export function takeLiveRequestIncidents(): string[] {
  const state = globalState();
  if (state === undefined) return [];
  const taken = state.incidents;
  state.incidents = [];
  return taken;
}

/** What the root hook throws: every incident, or `undefined` when there is none. */
export function liveRequestViolation(): Error | undefined {
  const incidents = takeLiveRequestIncidents();
  if (incidents.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const incident of incidents) {
    counts.set(incident, (counts.get(incident) ?? 0) + 1);
  }
  const lines = [...counts].map(([incident, count]) =>
    count === 1 ? incident : `${incident} (${String(count)} times)`,
  );
  return new Error(
    `research_helper integration guard (plan/00 §6 item 347(c)): ` +
      `${lines.join("; ")}. Cancelled before it connected. Double the source, ` +
      `or take the window's related host away first.`,
  );
}

/** Europe PMC's REST service, which a summary's full-text ladder asks by DOI. */
const EUROPE_PMC_REST = "https://www.ebi.ac.uk/europepmc/webservices/rest/";

/**
 * Answer every Europe PMC request "no such paper", as the service does for a
 * fixture's `10.5555` DOI, with nothing sent (the integration round of 2026-11-05).
 *
 * A report or a summary run on the real graph walks `acquire.ts`'s full-text ladder
 * for each item with a DOI, whatever provider answers the model's half. That is
 * `createZoteroHttpTransport` calling `Zotero.HTTP.request`, so this double sits on
 * that one method. Anything else still reaches the real one and the guard.
 *
 * @returns how to put the real method back
 */
export function answerEuropePmcWithNothing(): () => void {
  const http = Zotero.HTTP as unknown as {
    request: (method: string, url: string, options?: unknown) => unknown;
  };
  const real = http.request;
  http.request = (method, url, options) => {
    if (!url.startsWith(EUROPE_PMC_REST)) {
      return real.call(http, method, url, options);
    }
    return Promise.resolve({
      status: 200,
      responseText: '{"hitCount":0,"resultList":{"result":[]}}',
      responseURL: url,
      getAllResponseHeaders: () => "content-type: application/json\r\n",
    });
  };
  return () => {
    http.request = real;
  };
}

/** What the guard read, for the run's log. */
export function liveGuardSummary(): {
  readonly channels: number;
  readonly passedHosts: readonly string[];
  readonly passedAway: readonly string[];
} {
  const state = globalState();
  return {
    channels: state?.channels ?? 0,
    passedHosts: [...(state?.passedHosts ?? [])].sort(),
    passedAway: [...(state?.passedAway ?? [])].sort(),
  };
}

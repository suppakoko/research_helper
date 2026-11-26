/* eslint-disable no-restricted-globals -- an integration spec runs inside a live Zotero (docs/13 §2.3); it doubles Zotero.HTTP.request for one loopback URL and tees Zotero.debug, and there is no src/zotero/ facade for either from outside the plugin bundle. */
/**
 * `P1-T47` (`plan/00` §6 item 417(b)) — a stored or logged stack names no
 * folder of the user's, measured in the plugin's own bundle inside Zotero.
 *
 * **Why inside Zotero.** The unit tests in `test/unit/core/errors.test.ts`
 * plant the frame shapes; this spec checks the shape SpiderMonkey actually
 * writes. Every frame of the plugin's own code names the add-on's `rootURI`
 * (`addon/bootstrap.js`'s `startup` loads the bundle from it): here the build
 * folder, `file:///…/.scaffold/build/addon/`, and for an XPI in a profile's
 * `extensions` folder `jar:file:///<profile>/extensions/<id>.xpi!/`, which is
 * under the home folder by default. Measured 2026-11-26 (`plan/reports/P7-batchM.md`).
 *
 * **What is real.** The plugin's HTTP client, its typed error and that
 * error's `toSerialized`, the job queue's `fail` (the call the summarize,
 * report and audio pipelines make) with its gate and the plugin database, and
 * the plugin's logger. **The double.** `Zotero.HTTP.request` answers 400 for
 * one loopback URL that is never contacted; every other call goes on to the
 * real method and the suite's live-request guard.
 *
 * **What is searched for.** The home folder, the test profile and the
 * add-on's root, each as a path, with forward slashes and as a `file:` URL,
 * and the two schemes themselves. Only counts and reduced frames are logged:
 * a reduced frame holds no folder.
 */

import { config } from "../../package.json";
import type Addon from "../../src/addon";
import type { SerializedError } from "../../src/core/errors";

interface MochaContext {
  timeout(ms: number): void;
}
declare function describe(title: string, body: () => void): void;
declare function it(
  title: string,
  body: (this: MochaContext) => Promise<void>,
): void;
declare const assert: {
  strictEqual<T>(actual: T, expected: T, message?: string): void;
  isTrue(value: boolean, message?: string): void;
  isAbove(value: number, floor: number, message?: string): void;
  notInclude(haystack: string, needle: string, message?: string): void;
  fail(message: string): never;
};
/** The scaffold runner's `window.debug`: POSTs one line to the terminal. */
declare function debug(line: string): void;

const PROBE_URL = "http://127.0.0.1:9/p1t47/stack";
const PIPELINE = "p1t47-stack-probe";
/** A plugin frame after the reduction: `<function>@content/scripts/research-helper.js:<line>:<col>`. */
const REDUCED_FRAME = new RegExp(
  `@content/scripts/${config.addonRef}\\.js:\\d+:\\d+$`,
  "m",
);

function log(line: string): void {
  debug(`[P1-T47] ${line}`);
}

function graphOf(): NonNullable<Addon["api"]["services"]> {
  const instance = (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
  const graph = instance?.api.services;
  if (!graph) assert.fail("registerUI() published no api.services");
  return graph;
}

interface DirectoryService {
  get(key: string, iid: unknown): { path: string };
}
interface IoService {
  newFileURI(file: unknown): { spec: string };
}

/** Each folder that must not appear, in every form a stack could hold it. */
function folderForms(): readonly string[] {
  const services = Services as unknown as {
    dirsvc: DirectoryService;
    io: IoService;
  };
  const nsIFile = (Components.interfaces as unknown as Record<string, unknown>)
    .nsIFile;
  const forms: string[] = [];
  const add = (path: string): void => {
    if (path === "") return;
    const forward = path.replaceAll("\\", "/");
    forms.push(path, forward, encodeURI(forward));
    try {
      forms.push(
        services.io
          .newFileURI(Zotero.File.pathToFile(path))
          .spec.replace(/\/$/u, ""),
      );
    } catch {
      // A path that names no file still has its plain forms above.
    }
  };
  add(services.dirsvc.get("Home", nsIFile).path);
  add(PathUtils.profileDir);
  return forms;
}

function assertNoFolder(text: string, where: string): void {
  for (const scheme of ["file:", "jar:"]) {
    assert.notInclude(text, scheme, `${where} holds a ${scheme} URL`);
  }
  for (const form of folderForms()) {
    assert.isTrue(
      !text.toLowerCase().includes(form.toLowerCase()),
      `${where} names a local folder (form ${String(folderForms().indexOf(form))})`,
    );
  }
}

/** A real error from the plugin's HTTP client: a 400 for {@link PROBE_URL}. */
async function pluginError(): Promise<
  Error & { toSerialized(): SerializedError }
> {
  const http = Zotero.HTTP as unknown as {
    request: (...args: unknown[]) => Promise<unknown>;
  };
  const real = http.request;
  http.request = function (this: unknown, ...args: unknown[]) {
    if (args[1] === PROBE_URL) {
      return Promise.resolve({
        status: 400,
        responseText: "P1-T47 probe",
        response: "P1-T47 probe",
        responseURL: PROBE_URL,
        getAllResponseHeaders: () => "content-type: text/plain\r\n",
        getResponseHeader: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/plain" : null,
      });
    }
    return real.apply(this, args);
  };
  try {
    await graphOf().http.request("GET", PROBE_URL, {});
  } catch (error) {
    return error as Error & { toSerialized(): SerializedError };
  } finally {
    http.request = real;
  }
  assert.fail("the plugin's HTTP client accepted a 400");
}

/** Store `error` through the queue, read the row back, and delete it. */
async function storedStack(error: SerializedError): Promise<string> {
  const graph = graphOf();
  const open = await graph.database.ready;
  if (open === undefined) assert.fail("the plugin database is not open");
  const job = await graph.jobs.enqueue(PIPELINE, { probe: true });
  try {
    await graph.jobs.start(job.id);
    await graph.jobs.fail(job.id, error);
    const row: unknown = await open.connection.valueQueryAsync(
      "SELECT error_json FROM job WHERE id = ?",
      [job.id],
    );
    if (typeof row !== "string") assert.fail("the job row has no error_json");
    const stack = (JSON.parse(row) as SerializedError).stack;
    if (stack === undefined) assert.fail("the stored error has no stack");
    return stack;
  } finally {
    await open.connection.queryAsync("DELETE FROM job WHERE id = ?", [job.id]);
  }
}

describe("P1-T47: a stored or logged stack names no folder of the user's", function () {
  it("stores a real error's plugin frames as content/scripts/…:<line>:<col>", async function () {
    this.timeout(60_000);
    const error = await pluginError();
    const live = error.stack ?? "";
    assert.isTrue(
      live.includes(".js:"),
      "the live error has a stack with frames",
    );
    const stack = await storedStack(error.toSerialized());
    assertNoFolder(stack, "the stored stack");
    const plugin = stack.split("\n").filter((l) => REDUCED_FRAME.test(l));
    assert.isAbove(
      plugin.length,
      0,
      "the stored stack keeps the plugin's frames",
    );
    log(
      `stored: ${String(plugin.length)} plugin frame(s), first ${plugin[0] ?? ""}`,
    );
  });

  it("stores a planted frame under the home folder without the folder", async function () {
    this.timeout(60_000);
    const error = await pluginError();
    // The shape an XPI in a profile's `extensions` folder gives, under this
    // machine's own home folder (`plan/reports/P7-batchM.md`).
    const services = Services as unknown as {
      dirsvc: DirectoryService;
      io: IoService;
    };
    const home = services.io
      .newFileURI(
        services.dirsvc.get(
          "Home",
          (Components.interfaces as unknown as Record<string, unknown>).nsIFile,
        ),
      )
      .spec.replace(/\/$/u, "");
    const frame = `listCollections@jar:${home}/AppData/Roaming/Zotero/Zotero/Profiles/p1t47.default/extensions/${config.addonID}.xpi!/content/scripts/${config.addonRef}.js:59525:32`;
    Object.defineProperty(error, "stack", {
      value: `${frame}\n${error.stack ?? ""}`,
    });
    const stack = await storedStack(error.toSerialized());
    assertNoFolder(stack, "the stored planted stack");
    assert.strictEqual(
      stack.split("\n")[0],
      `listCollections@content/scripts/${config.addonRef}.js:59525:32`,
      "the planted frame keeps its function, resource path, line and column",
    );
    log(`planted frame stored as ${stack.split("\n")[0] ?? ""}`);
  });

  it("logs a context error's stack without the folder", async function () {
    this.timeout(60_000);
    const error = await pluginError();
    const debugFn = Zotero as unknown as {
      debug: (...args: unknown[]) => unknown;
    };
    const real = debugFn.debug;
    const seen: string[] = [];
    debugFn.debug = function (this: unknown, ...args: unknown[]) {
      seen.push(String(args[0]));
      return real.apply(this, args);
    };
    try {
      graphOf().logger.error("P1-T47 logged stack probe", { error });
    } finally {
      debugFn.debug = real;
    }
    // An `error` line reaches `Zotero.debug` twice: once by the sink's `write`,
    // once by its `reportError`, because `Zotero.logError` writes to the debug
    // output too (`createZoteroLogSink` in `src/bootstrap/container.ts`).
    // Every copy is checked.
    const lines = seen.filter((l) => l.includes("P1-T47 logged stack probe"));
    assert.isAbove(lines.length, 0, "the logger wrote the line");
    for (const [i, line] of lines.entries()) {
      assertNoFolder(line, `log line ${String(i + 1)}`);
      assert.isTrue(
        REDUCED_FRAME.test(line.replaceAll("\\n", "\n")),
        `log line ${String(i + 1)} keeps the plugin's frames`,
      );
    }
    log(`${String(lines.length)} log line(s), none names a folder`);
  });
});

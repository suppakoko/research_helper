import { config } from "../package.json";
import hooks from "./hooks";
import { createScope, type Scope } from "./bootstrap/container";

/**
 * The plugin instance, reachable at `Zotero.ResearchHelper`.
 *
 * `docs/07` §2.2: "holds the DI container + lifecycle state". `P0-T07` fills
 * in the lifecycle half — `scope`, the teardown registry every registration
 * passes through. The service-locator half arrives with Phase 1, which
 * rewrites `src/bootstrap/container.ts` against real services.
 *
 * `data.initialized` is polled by `zotero-plugin.config.ts`'s
 * `test.waitForPlugin` (`docs/13` §1.4), which is why `hooks.onStartup` sets
 * it last and `hooks.onShutdown` clears it.
 */
class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    locale?: {
      current: any;
    };
  };

  /**
   * The root teardown registry. One per enabled lifetime of the plugin: a
   * disable/enable cycle deletes the plugin object off `Zotero` and
   * `src/index.ts` news up a fresh `Addon`, so a torn-down scope is never
   * reused.
   */
  public readonly scope: Scope;

  public hooks: typeof hooks;
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };

    this.scope = createScope({
      description: config.addonRef,
      // Teardown failures are reported, never thrown: FR-56 wants the rest of
      // the teardown to finish. This is the one place they become visible,
      // so it logs the stack — `docs/01` §12 gotcha 15 forbids logging
      // request bodies and keys, not error stacks from our own lifecycle.
      onError: (message, error) => {
        const detail =
          error instanceof Error
            ? `${error.message}\n${error.stack ?? "(no stack)"}`
            : String(error);
        Zotero.debug(`[${config.addonName}] ${message}: ${detail}`);
      },
      strict: __env__ === "development",
    });

    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;

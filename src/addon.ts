import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

/**
 * The plugin instance, reachable at `Zotero.ResearchHelper`.
 *
 * P0-T04 replaces this with the real composition root from docs/07 §2.2.
 * For now it carries only what bootstrap.js and the scaffold's test runner
 * need: the lifecycle hooks, and `data.initialized`, which
 * zotero-plugin.config.ts's `test.waitForPlugin` polls.
 */
class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
  };

  public hooks: typeof hooks;
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;

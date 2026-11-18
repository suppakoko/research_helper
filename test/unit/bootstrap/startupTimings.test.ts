import { describe, expect, it } from "vitest";
import { startupTimings } from "../../../src/bootstrap/startupTimings";

/**
 * `P7-T15` (`NFR-10`): the arithmetic behind `addon.data.startup`. The live
 * figures are `test/integration/startupCost.spec.ts`'s.
 */
describe("startupTimings (P7-T15, NFR-10)", () => {
  it("splits onStartup's four marks into Zotero's wait and the plugin's own work", () => {
    expect(startupTimings(1_000, 1_250, 1_290, 1_305)).toStrictEqual({
      barrierMs: 250,
      registerUIMs: 40,
      windowsMs: 15,
      ownMs: 55,
    });
  });

  it("counts the plugin's own work from the barrier, not from entry", () => {
    const timings = startupTimings(0, 5_000, 5_010, 5_012);
    expect(timings.ownMs).toBe(12);
    expect(timings.ownMs).toBe(timings.registerUIMs + timings.windowsMs);
  });

  it("is zero throughout when nothing waited and nothing ran", () => {
    expect(startupTimings(7, 7, 7, 7)).toStrictEqual({
      barrierMs: 0,
      registerUIMs: 0,
      windowsMs: 0,
      ownMs: 0,
    });
  });
});

import { defineConfig } from "vitest/config";

/**
 * Vitest configuration — layer 1 of docs/13 §2's four-layer pyramid.
 *
 * The runner split is deliberate and documented (docs/13 §2.1): Vitest runs
 * *outside* Zotero, in plain Node, over the ~80% of the tree that docs/07 §2.3's
 * dependency rule keeps Zotero-free. Mocha runs *inside* Zotero via the scaffold
 * test runner (docs/13 §2.3, card P0-T13). Neither crosses into the other's half.
 *
 * `package.json`'s `test:unit` script is `vitest run --dir test/unit`, the exact
 * form docs/13 §1.6 lists, so no `include` globs are configured here: the
 * directory is selected on the command line and P0-T14's CI job invokes the same
 * script.
 */
export default defineConfig({
  test: {
    // The minimal Zotero fake of docs/13 §2.1. It is installed for every unit
    // test, but almost nothing should need it — pure modules must not reference
    // Zotero at all, and a test that wants a richer fake is a signal the code
    // belongs in an integration test.
    setupFiles: ["test/setup/zotero-global.ts"],

    coverage: {
      // docs/13 §2.1 names v8 as Vitest's built-in coverage provider.
      provider: "v8",
      reportsDirectory: "coverage",
      // Report on the whole of src/, not only the files a run happened to
      // import, so that an untested module reads as 0% rather than as absent.
      include: ["src/**/*.ts"],
      // No `thresholds` block yet. docs/13 §2 sets ≥ 85% line coverage on
      // src/core/, src/sources/*/normalize* and src/llm/ — all three are empty
      // directories today, so a threshold here would be a gate on nothing.
      // Phase 1 is where it starts to mean something.
    },
  },
});

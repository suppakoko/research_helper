/**
 * A prompt file imported as text — `P3-T24`, `docs/12` §17.3 (decided
 * 2026-10-20, `plan/00` §6 item 237).
 *
 * `src/prompts/bundled.ts` imports each prompt file as
 * `import text from "./x.v1.0.0.md" with { type: "text" }`. esbuild inlines the
 * file as a string in both the plugin build and the scaffold's test build, with
 * no loader configured; this declaration is what lets `tsc` type the import.
 * It describes only that form: a plain `import x from "./x.md"`, with no
 * attribute, type-checks too but fails to bundle.
 */
declare module "*.md" {
  const text: string;
  export default text;
}

/**
 * The prompt registry — `P3-T24`.
 *
 * Prompts are data, not string literals (`docs/12` §17.3). Each prompt lives in
 * one versioned Markdown file beside this module, `<kebab-id>.v<version>.md`,
 * whose front matter carries the version and the call defaults and whose body
 * carries the system and user text. This module parses those files, validates
 * them, and renders their `{{PLACEHOLDER}}`s.
 *
 * ## File format
 *
 * ```
 * ---
 * id: PAPER_SUMMARY_ABSTRACT
 * version: 1.0.0
 * cacheEpoch: 1
 * schema: paper-summary.v1.json        # or `none`
 * defaultTemperature: 0
 * defaultMaxTokens: 1200               # or `maxTokensPerItem: 100`, never both
 * outputFormat: json
 * lastReviewed: 2026-09-09
 * variables:
 *   - ITEM_KEY
 *   - ...
 * ---
 *
 * ## system
 *
 * (a fenced `text` block)
 *
 * ## user
 *
 * (a fenced `text` block)
 * ```
 *
 * Two departures from `docs/12` §17.3's example, both forced:
 *
 * - **`variables`.** §17.3 requires "every `{{PLACEHOLDER}}` in the text is
 *   declared, and every declared variable is used", but its example front
 *   matter has no field to declare them in. `variables` is that field.
 * - **`maxTokensPerItem`.** `RELEVANCE_SCREEN`'s `max_tokens` is
 *   `100 × batch size` (`docs/12` §3), not a constant, so it has no
 *   `defaultMaxTokens`; {@link resolveMaxTokens} does the multiplication.
 *
 * The prompt text sits in fenced `text` blocks, as it does in `docs/12`, so a
 * future prompt that contains its own `## ` headings (the trend-report prompts
 * do) cannot be mistaken for a section boundary.
 *
 * ## The bundling seam
 *
 * Nothing here imports a `.md` file. The seam is {@link createPromptRegistry}:
 * its caller supplies a `PromptSourceFile[]` — one `{ fileName, text }` per
 * file, including every file named in {@link PROMPT_FILE_NAMES} — and calls it
 * once. In the bundle that caller is `./bundled.ts`, which imports the files
 * with `with { type: "text" }` and exports the registry and `PROMPT_VERSIONS`
 * (decided 2026-10-20, `plan/00` §6 item 237). The unit tests never import
 * `./bundled.ts`, because Vitest cannot import a `.md` file; they read the
 * files from disk and pass their text in.
 *
 * The one schema file is imported as JSON, which esbuild, Vitest and `tsc`
 * all handle with no configuration (the tree already imports `package.json`
 * the same way), so it does not depend on the open line.
 *
 * ## Rendering
 *
 * {@link renderPrompt} is one literal, single-pass substitution (`docs/12`
 * §1.1 rule 1): a value that itself contains `{{X}}` is not expanded again.
 * Every value is passed through {@link escapeSourceText} first (§1.1 rule 3),
 * so no value can close the `<<<SOURCE_TEXT>>>` fence it sits in. The system
 * text never contains a placeholder — validation rejects one — so per-paper
 * content cannot reach the system message (§1.1 rule 2).
 */

import { ConfigurationError } from "../core/errors";
import paperSummarySchemaV1 from "./schemas/paper-summary.v1.json";
import relevanceScreenSchemaV1 from "./schemas/relevance-screen.v1.json";

// ---------------------------------------------------------------------------
// Identifiers and the file list
// ---------------------------------------------------------------------------

/** The prompts this registry ships, in `docs/12` §1.2's order. */
export const PROMPT_IDS = [
  "RELEVANCE_SCREEN",
  "PAPER_SUMMARY_ABSTRACT",
  "PAPER_SUMMARY_FULLTEXT",
  "CHUNK_MAP",
  "CHUNK_REDUCE",
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

/**
 * The active file for each prompt. A new version is a new file and a new entry
 * here; a released file is never edited in place (`docs/12` §17.5). The old
 * file may stay in the source list handed to {@link createPromptRegistry}, which
 * keeps it readable through {@link PromptRegistry.getVersion}.
 */
export const PROMPT_FILE_NAMES: Readonly<Record<PromptId, string>> =
  Object.freeze({
    RELEVANCE_SCREEN: "relevance-screen.v1.0.0.md",
    PAPER_SUMMARY_ABSTRACT: "paper-summary-abstract.v1.0.0.md",
    PAPER_SUMMARY_FULLTEXT: "paper-summary-fulltext.v1.0.0.md",
    CHUNK_MAP: "chunk-map.v1.0.0.md",
    CHUNK_REDUCE: "chunk-reduce.v1.0.0.md",
  });

/** A JSON Schema document, as parsed. */
export type JsonSchemaObject = Readonly<Record<string, unknown>>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * The schema files a prompt's `schema:` field may name. Frozen: the parsed JSON
 * is module state shared by every template that names it.
 */
export const PROMPT_SCHEMAS: Readonly<Record<string, JsonSchemaObject>> =
  Object.freeze({
    "paper-summary.v1.json": deepFreeze(
      paperSummarySchemaV1 as JsonSchemaObject,
    ),
    // `docs/12` §3's `RelevanceScreen` (`P3-T27`; `plan/00` §6 item 239(c)).
    // `relevance-screen.v1.0.0.md` keeps `schema: none` — a released file is
    // not edited (§17.5) — so `src/pipeline/shared/relevanceScreen.ts`
    // attaches this one itself (`docs/12` §3's note of 2026-10-24).
    "relevance-screen.v1.json": deepFreeze(
      relevanceScreenSchemaV1 as JsonSchemaObject,
    ),
  });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptOutputFormat = "json" | "markdown" | "text";

/** One prompt file's raw text, as the bundling step will supply it. */
export interface PromptSourceFile {
  readonly fileName: string;
  readonly text: string;
}

/** A parsed, validated prompt. */
export interface PromptTemplate {
  readonly id: PromptId;
  /** `MAJOR.MINOR.PATCH`, no leading `v` (`docs/12` §17.2, §17.3). */
  readonly version: string;
  /**
   * The cache namespace for this prompt. Patch-equivalent versions share one;
   * a MINOR or MAJOR bump moves to a higher one (`docs/12` §17.2).
   */
  readonly cacheEpoch: number;
  readonly system: string;
  readonly user: string;
  /** The parsed output schema, or `null` when the file says `schema: none`. */
  readonly schema: JsonSchemaObject | null;
  readonly schemaFile: string | null;
  readonly defaultTemperature: number;
  /** `null` exactly when {@link maxTokensPerItem} is set. */
  readonly defaultMaxTokens: number | null;
  /** `null` exactly when {@link defaultMaxTokens} is set. */
  readonly maxTokensPerItem: number | null;
  readonly outputFormat: PromptOutputFormat;
  readonly lastReviewed: string;
  /** The declared placeholders, in declaration order. */
  readonly variables: readonly string[];
  readonly fileName: string;
}

/** The system and user messages of one rendered prompt. */
export interface RenderedPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * A malformed prompt file, a registry that cannot be assembled, or a render
 * call with the wrong variables. Every problem found is listed, not only the
 * first, so one test run shows everything wrong with a file.
 */
export class PromptRegistryError extends ConfigurationError {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Prompt registry: ${problems.join("; ")}`, {
      problemCount: problems.length,
    });
    this.problems = Object.freeze([...problems]);
  }
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

const FRONT_MATTER_KEYS = [
  "id",
  "version",
  "cacheEpoch",
  "schema",
  "defaultTemperature",
  "defaultMaxTokens",
  "maxTokensPerItem",
  "outputFormat",
  "lastReviewed",
  "variables",
] as const;

type FrontMatterKey = (typeof FRONT_MATTER_KEYS)[number];

const OUTPUT_FORMATS: readonly PromptOutputFormat[] = [
  "json",
  "markdown",
  "text",
];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
/** A well-formed placeholder. Anything else containing `{{` is malformed. */
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const MAX_TEMPERATURE = 2;

const SYSTEM_HEADING = "## system";
const USER_HEADING = "## user";
const FENCE_OPEN = "```text";
const FENCE_CLOSE = "```";

function isPromptId(value: string): value is PromptId {
  return (PROMPT_IDS as readonly string[]).includes(value);
}

function isFrontMatterKey(value: string): value is FrontMatterKey {
  return (FRONT_MATTER_KEYS as readonly string[]).includes(value);
}

/** `PAPER_SUMMARY_ABSTRACT` → `paper-summary-abstract`. */
function fileStem(id: string): string {
  return id.toLowerCase().replaceAll("_", "-");
}

interface FrontMatter {
  readonly scalars: ReadonlyMap<FrontMatterKey, string>;
  readonly variables: readonly string[] | undefined;
}

/**
 * The front-matter subset this format uses: `key: value` lines, and one block
 * list (`variables:` followed by `  - NAME` lines). Not YAML; anything else is
 * a problem.
 */
function parseFrontMatter(lines: readonly string[], problems: string[]) {
  const scalars = new Map<FrontMatterKey, string>();
  let variables: string[] | undefined;
  let inVariables = false;

  for (const line of lines) {
    const item = /^ {2}- (.*)$/.exec(line);
    if (item) {
      if (!inVariables || variables === undefined) {
        problems.push(`list item outside \`variables\`: "${line}"`);
      } else {
        variables.push((item[1] ?? "").trim());
      }
      continue;
    }
    inVariables = false;
    if (line.trim() === "") continue;

    const pair = /^([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(line);
    if (!pair) {
      problems.push(`unreadable front-matter line: "${line}"`);
      continue;
    }
    const key = pair[1] ?? "";
    const value = (pair[2] ?? "").trim();
    if (!isFrontMatterKey(key)) {
      problems.push(`unknown front-matter key \`${key}\``);
      continue;
    }
    if (scalars.has(key) || (key === "variables" && variables !== undefined)) {
      problems.push(`duplicate front-matter key \`${key}\``);
      continue;
    }
    if (key === "variables") {
      if (value !== "") {
        problems.push("`variables` must be a block list of `  - NAME` lines");
      }
      variables = [];
      inVariables = true;
      continue;
    }
    scalars.set(key, value);
  }
  return { scalars, variables } satisfies FrontMatter;
}

/** The text of the one fenced `text` block in `lines`, or a problem. */
function readFencedSection(
  name: string,
  lines: readonly string[],
  problems: string[],
): string {
  const nonBlank = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() !== "");
  const first = nonBlank[0];
  const last = nonBlank[nonBlank.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    first.line !== FENCE_OPEN ||
    last.line !== FENCE_CLOSE ||
    first.index === last.index
  ) {
    problems.push(
      `the \`${name}\` section must be exactly one fenced \`text\` block`,
    );
    return "";
  }
  const body = lines.slice(first.index + 1, last.index);
  if (body.some((line) => line.startsWith(FENCE_CLOSE))) {
    problems.push(`the \`${name}\` section contains a nested fence`);
  }
  return body.join("\n");
}

function readInteger(
  scalars: ReadonlyMap<FrontMatterKey, string>,
  key: FrontMatterKey,
  problems: string[],
): number | null {
  const raw = scalars.get(key);
  if (raw === undefined) return null;
  if (!POSITIVE_INTEGER.test(raw)) {
    problems.push(`\`${key}\` must be a positive integer, got "${raw}"`);
    return null;
  }
  return Number(raw);
}

/**
 * Parse and validate one prompt file.
 *
 * Checks `docs/12` §17.3's load-time rules — a version, a positive-integer
 * `cacheEpoch`, every placeholder declared and every declared variable used —
 * plus the ones this format needs to be unambiguous: the file name agrees with
 * the `id` and `version`, the schema file exists, exactly one max-tokens field
 * is set, and the system text holds no placeholder.
 *
 * @throws PromptRegistryError listing every problem in the file.
 */
export function parsePromptFile(
  file: PromptSourceFile,
  schemas: Readonly<Record<string, JsonSchemaObject>> = PROMPT_SCHEMAS,
): PromptTemplate {
  const problems: string[] = [];
  const fail = (): never => {
    throw new PromptRegistryError(
      problems.map((problem) => `${file.fileName}: ${problem}`),
    );
  };

  // Line endings are not content. A CRLF checkout must render the same bytes,
  // or the system message stops being byte-identical across machines.
  const text = file.text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  // ---- front matter ----
  const close = lines.indexOf("---", 1);
  if (lines[0] !== "---" || close < 0) {
    problems.push("missing the `---` front-matter block");
    return fail();
  }
  const { scalars, variables } = parseFrontMatter(
    lines.slice(1, close),
    problems,
  );

  const id = scalars.get("id");
  if (id === undefined) problems.push("missing `id`");
  else if (!isPromptId(id)) problems.push(`unknown prompt id \`${id}\``);

  const version = scalars.get("version");
  if (version === undefined) problems.push("missing `version`");
  else if (!SEMVER.test(version)) {
    problems.push(`\`version\` must be MAJOR.MINOR.PATCH, got "${version}"`);
  }

  if (!scalars.has("cacheEpoch")) problems.push("missing `cacheEpoch`");
  const cacheEpoch = readInteger(scalars, "cacheEpoch", problems);

  if (id !== undefined && version !== undefined) {
    const expected = `${fileStem(id)}.v${version}.md`;
    if (file.fileName !== expected) {
      problems.push(
        `file name must be "${expected}" for id ${id} version ${version}`,
      );
    }
  }

  const schemaName = scalars.get("schema");
  let schema: JsonSchemaObject | null = null;
  if (schemaName === undefined) {
    problems.push("missing `schema` (use `none` for no schema)");
  } else if (schemaName !== "none") {
    const found = schemas[schemaName];
    if (found === undefined) problems.push(`unknown schema "${schemaName}"`);
    else schema = found;
  }

  const temperatureRaw = scalars.get("defaultTemperature");
  let defaultTemperature = 0;
  if (temperatureRaw === undefined) {
    problems.push("missing `defaultTemperature`");
  } else if (
    !DECIMAL.test(temperatureRaw) ||
    Number(temperatureRaw) > MAX_TEMPERATURE
  ) {
    problems.push(
      `\`defaultTemperature\` must be a number from 0 to ${MAX_TEMPERATURE}, got "${temperatureRaw}"`,
    );
  } else {
    defaultTemperature = Number(temperatureRaw);
  }

  const defaultMaxTokens = readInteger(scalars, "defaultMaxTokens", problems);
  const maxTokensPerItem = readInteger(scalars, "maxTokensPerItem", problems);
  const maxTokenFields = ["defaultMaxTokens", "maxTokensPerItem"] as const;
  const maxTokenFieldCount = maxTokenFields.filter((k) =>
    scalars.has(k),
  ).length;
  if (maxTokenFieldCount !== 1) {
    problems.push(
      "exactly one of `defaultMaxTokens` and `maxTokensPerItem` must be set",
    );
  }

  const outputFormat = scalars.get("outputFormat");
  if (outputFormat === undefined) problems.push("missing `outputFormat`");
  else if (!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) {
    problems.push(`unknown \`outputFormat\` "${outputFormat}"`);
  }

  const lastReviewed = scalars.get("lastReviewed");
  if (lastReviewed === undefined) problems.push("missing `lastReviewed`");
  else if (!ISO_DATE.test(lastReviewed)) {
    problems.push(`\`lastReviewed\` must be YYYY-MM-DD, got "${lastReviewed}"`);
  }

  if (variables === undefined) problems.push("missing `variables`");
  const declared = variables ?? [];
  for (const name of declared) {
    if (!VARIABLE_NAME.test(name)) {
      problems.push(`variable name "${name}" must be UPPER_SNAKE_CASE`);
    }
  }
  const duplicates = declared.filter((n, i) => declared.indexOf(n) !== i);
  for (const name of new Set(duplicates)) {
    problems.push(`variable ${name} is declared twice`);
  }

  // ---- body ----
  const body = lines.slice(close + 1);
  const systemAt = body.flatMap((l, i) => (l === SYSTEM_HEADING ? [i] : []));
  const userAt = body.flatMap((l, i) => (l === USER_HEADING ? [i] : []));
  let system = "";
  let user = "";
  const systemIndex = systemAt[0];
  const userIndex = userAt[0];
  if (
    systemAt.length !== 1 ||
    userAt.length !== 1 ||
    systemIndex === undefined ||
    userIndex === undefined ||
    systemIndex > userIndex
  ) {
    problems.push(
      `the body must hold one \`${SYSTEM_HEADING}\` and then one \`${USER_HEADING}\` section`,
    );
  } else {
    if (body.slice(0, systemIndex).some((l) => l.trim() !== "")) {
      problems.push(`text before \`${SYSTEM_HEADING}\``);
    }
    system = readFencedSection(
      "system",
      body.slice(systemIndex + 1, userIndex),
      problems,
    );
    user = readFencedSection("user", body.slice(userIndex + 1), problems);
  }

  // ---- placeholders ----
  if (system.includes("{{") || system.includes("}}")) {
    problems.push(
      "the system text must contain no placeholder (docs/12 §1.1 rule 2)",
    );
  }
  if (user.replace(PLACEHOLDER, "").includes("{{")) {
    problems.push("the user text contains a malformed `{{` placeholder");
  }
  const used = new Set(Array.from(user.matchAll(PLACEHOLDER), (m) => m[1]));
  for (const name of used) {
    if (name !== undefined && !declared.includes(name)) {
      problems.push(`placeholder {{${name}}} is not declared in \`variables\``);
    }
  }
  for (const name of new Set(declared)) {
    if (!used.has(name)) {
      problems.push(`declared variable ${name} is not used in the user text`);
    }
  }

  if (problems.length > 0) return fail();

  return Object.freeze({
    id: id as PromptId,
    version: version as string,
    cacheEpoch: cacheEpoch as number,
    system,
    user,
    schema,
    schemaFile: schemaName === "none" ? null : (schemaName ?? null),
    defaultTemperature,
    defaultMaxTokens,
    maxTokensPerItem,
    outputFormat: outputFormat as PromptOutputFormat,
    lastReviewed: lastReviewed as string,
    variables: Object.freeze([...declared]),
    fileName: file.fileName,
  });
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface PromptRegistry {
  /** The active version of `id` — the file {@link PROMPT_FILE_NAMES} names. */
  get(id: PromptId): PromptTemplate;
  /** A specific version of `id`, if its file was supplied. */
  getVersion(id: PromptId, version: string): PromptTemplate | undefined;
  /**
   * Each prompt's active version string: the provenance a cached output
   * records, and what the startup comparison stores (`P3-T26`).
   */
  readonly versions: Readonly<Record<PromptId, string>>;
  /**
   * Each prompt's active `cacheEpoch`: what the summary cache keys on, so a
   * PATCH bump keeps cached outputs (`docs/12` §17.2; owner, 2026-10-23,
   * `plan/00` §6 item 273(a)).
   */
  readonly cacheEpochs: Readonly<Record<PromptId, number>>;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * A version's cache line, `MAJOR.MINOR`: the versions that share one
 * `cacheEpoch` ({@link createPromptRegistry} holds one epoch per line, and a
 * higher line a strictly higher epoch). The summary cache tags its entries
 * with it, so a PATCH bump changes neither the key nor the tag (`docs/06`
 * §11.2, reading 8, corrected 2026-10-23).
 *
 * @param version - `MAJOR.MINOR.PATCH`; anything else is returned with its
 *   first two dot-separated parts, so a malformed version still names a line
 */
export function promptCacheLine(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/**
 * Parse every supplied file and assemble the registry. **This is the bundling
 * seam** (see the module comment): the caller supplies the files' text.
 *
 * Beyond each file's own validation, the set must hold the active file of
 * every {@link PROMPT_IDS} entry, no version twice, and `cacheEpoch`s that
 * follow `docs/12` §17.2 across the versions of one prompt: equal for the same
 * MAJOR.MINOR (a PATCH keeps the cache), strictly higher for a higher one.
 *
 * @throws PromptRegistryError listing every problem across every file.
 */
export function createPromptRegistry(
  files: readonly PromptSourceFile[],
  schemas: Readonly<Record<string, JsonSchemaObject>> = PROMPT_SCHEMAS,
): PromptRegistry {
  const problems: string[] = [];
  const byId = new Map<PromptId, PromptTemplate[]>();

  for (const file of files) {
    try {
      const template = parsePromptFile(file, schemas);
      const list = byId.get(template.id) ?? [];
      if (list.some((t) => t.version === template.version)) {
        problems.push(
          `${file.fileName}: ${template.id} version ${template.version} is supplied twice`,
        );
        continue;
      }
      list.push(template);
      byId.set(template.id, list);
    } catch (error) {
      if (!(error instanceof PromptRegistryError)) throw error;
      problems.push(...error.problems);
    }
  }

  const active = new Map<PromptId, PromptTemplate>();
  for (const id of PROMPT_IDS) {
    const list = (byId.get(id) ?? []).sort((a, b) =>
      compareVersions(a.version, b.version),
    );
    const wanted = list.find((t) => t.fileName === PROMPT_FILE_NAMES[id]);
    if (wanted === undefined) {
      problems.push(`${PROMPT_FILE_NAMES[id]}: not supplied (active ${id})`);
    } else {
      active.set(id, wanted);
    }
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      if (prev === undefined || next === undefined) continue;
      const sameLine =
        promptCacheLine(prev.version) === promptCacheLine(next.version);
      if (sameLine && next.cacheEpoch !== prev.cacheEpoch) {
        problems.push(
          `${next.fileName}: a PATCH bump must keep cacheEpoch ${prev.cacheEpoch}`,
        );
      }
      if (!sameLine && next.cacheEpoch <= prev.cacheEpoch) {
        problems.push(
          `${next.fileName}: a MINOR or MAJOR bump must raise cacheEpoch above ${prev.cacheEpoch}`,
        );
      }
    }
  }

  if (problems.length > 0) throw new PromptRegistryError(problems);

  const versions = Object.freeze(
    Object.fromEntries(
      PROMPT_IDS.map((id) => [id, (active.get(id) as PromptTemplate).version]),
    ) as Record<PromptId, string>,
  );
  const cacheEpochs = Object.freeze(
    Object.fromEntries(
      PROMPT_IDS.map((id) => [
        id,
        (active.get(id) as PromptTemplate).cacheEpoch,
      ]),
    ) as Record<PromptId, number>,
  );

  return Object.freeze({
    get(id: PromptId): PromptTemplate {
      return active.get(id) as PromptTemplate;
    },
    getVersion(id: PromptId, version: string): PromptTemplate | undefined {
      return byId.get(id)?.find((t) => t.version === version);
    },
    versions,
    cacheEpochs,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const FENCE_MARKER = "<<<";
const ESCAPED_FENCE_MARKER = "< <<";

/**
 * `docs/12` §1.1 rule 3: replace `<<<` with `< <<` so content cannot open or
 * close a `<<<SOURCE_TEXT>>>` fence. Repeated until none is left, because one
 * pass over a run of four or more `<` leaves a fresh `<<<` behind.
 */
export function escapeSourceText(value: string): string {
  let out = value;
  while (out.includes(FENCE_MARKER)) {
    out = out.replaceAll(FENCE_MARKER, ESCAPED_FENCE_MARKER);
  }
  return out;
}

/**
 * Substitute `vars` into the template's user text. The system text is
 * returned unchanged.
 *
 * @throws PromptRegistryError if a declared variable is missing or an
 *   undeclared one is supplied.
 */
export function renderPrompt(
  template: PromptTemplate,
  vars: Readonly<Record<string, string>>,
): RenderedPrompt {
  const problems: string[] = [];
  for (const name of template.variables) {
    if (typeof vars[name] !== "string") {
      problems.push(`${template.id}: variable ${name} is missing`);
    }
  }
  for (const name of Object.keys(vars)) {
    if (!template.variables.includes(name)) {
      problems.push(`${template.id}: variable ${name} is not declared`);
    }
  }
  if (problems.length > 0) throw new PromptRegistryError(problems);

  const user = template.user.replace(PLACEHOLDER, (_match, name: string) =>
    escapeSourceText(vars[name] as string),
  );
  return Object.freeze({ system: template.system, user });
}

/**
 * The `max_tokens` for one call: the file's `defaultMaxTokens`, or
 * `maxTokensPerItem × batchSize` for a batched prompt (`RELEVANCE_SCREEN`).
 *
 * @throws PromptRegistryError if a batched prompt gets no positive integer
 *   batch size, or a fixed one gets a batch size at all.
 */
export function resolveMaxTokens(
  template: PromptTemplate,
  batchSize?: number,
): number {
  if (template.maxTokensPerItem !== null) {
    if (
      batchSize === undefined ||
      !Number.isInteger(batchSize) ||
      batchSize < 1
    ) {
      throw new PromptRegistryError([
        `${template.id}: max_tokens needs a positive integer batch size`,
      ]);
    }
    return template.maxTokensPerItem * batchSize;
  }
  if (batchSize !== undefined) {
    throw new PromptRegistryError([
      `${template.id}: max_tokens is fixed; no batch size applies`,
    ]);
  }
  return template.defaultMaxTokens as number;
}

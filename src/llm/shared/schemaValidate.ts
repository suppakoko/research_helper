/**
 * A dependency-free JSON Schema validator for the constructs the plugin's
 * output schemas use.
 *
 * **Scope.** `P3-T12` step 2. `docs/12` §18.4: validate every structured
 * response client-side "regardless of the provider's structured-output mode",
 * because `strict: true` is a strong signal, not a guarantee. NFR-18 forbids
 * bundling a JSON Schema library, so this file is the validator. Its caller is
 * `completeJSON` / `parseOrRepair` in `./jsonMode.ts`.
 *
 * **The supported subset** is exactly what `PaperSummary` v1
 * (`src/prompts/schemas/paper-summary.v1.json`, `docs/06` §6.2) and
 * `RelevanceScreen` (`docs/12` §3) use, under draft 2020-12 semantics:
 *
 * | keyword | applies to |
 * |---|---|
 * | `type` (one name or an array of names) | any value |
 * | `const`, `enum` (deep equality) | any value |
 * | `minLength`, `maxLength` (Unicode code points), `pattern` (unanchored, `u` flag) | strings |
 * | `minimum`, `maximum` (inclusive) | numbers |
 * | `minItems`, `maxItems`, `items` (one schema for every element) | arrays |
 * | `properties`, `required`, `additionalProperties` (`false`, `true` or a schema) | objects |
 *
 * Annotations (`$schema`, `$id`, `$comment`, `title`, `description`,
 * `default`, `examples`) are accepted and ignored.
 *
 * **Anything else is refused, not ignored.** A validator that skipped an
 * unknown assertion keyword (`oneOf`, `$ref`, `prefixItems`, …) would pass
 * output the schema forbids. {@link validateAgainstSchema} therefore checks
 * the schema first and throws `ConfigurationError` — a build defect, not a
 * model failure — before judging any value. `completeJSON` makes that check
 * before the first request, so an unsupported schema costs nothing.
 *
 * **Error strings** name a JSON Pointer path and the rule broken. They quote
 * schema text (a required name, a `const`, a pattern) and, for an extra
 * property, the property name the model sent — never a value the model sent,
 * so a string field's content is not copied. They are sent back to the same
 * model in the repair prompt (`docs/12` §18.3) and reach an error's context
 * only through `redactText` (`./jsonMode.ts`).
 */

import { ConfigurationError } from "../../core/errors";

/** A JSON Schema object, as parsed from JSON. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** The outcome of one validation. */
export interface SchemaValidationResult {
  readonly ok: boolean;
  /** One line per broken rule, `"<pointer>: <rule>"`; empty when `ok`. */
  readonly errors: readonly string[];
}

/** Keywords that carry no assertion; accepted anywhere and ignored. */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
]);

/** The assertion keywords this validator implements (the module header's table). */
export const SUPPORTED_ASSERTION_KEYWORDS: readonly string[] = Object.freeze([
  "type",
  "const",
  "enum",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "items",
  "properties",
  "required",
  "additionalProperties",
]);

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_ASSERTION_KEYWORDS);

/** The seven JSON Schema type names. */
const TYPE_NAMES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/** Schemas already checked, so a schema used for 200 items is walked once. */
const checkedSchemas = new WeakSet<object>();

/** Compiled `pattern`s, keyed by their source. */
const compiledPatterns = new Map<string, RegExp>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** One RFC 6901 reference token. */
function pointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function child(pointer: string, token: string | number): string {
  return `${pointer}/${pointerToken(String(token))}`;
}

function at(pointer: string): string {
  return pointer === "" ? "/" : pointer;
}

/** The compiled form of a `pattern`, or `undefined` when it does not compile. */
function compilePattern(source: string): RegExp | undefined {
  const cached = compiledPatterns.get(source);
  if (cached !== undefined) return cached;
  try {
    const compiled = new RegExp(source, "u");
    compiledPatterns.set(source, compiled);
    return compiled;
  } catch {
    return undefined;
  }
}

/**
 * Every problem with `schema` itself: an unsupported keyword, or a supported
 * keyword whose value is not of the shape the specification gives it.
 *
 * @param schema - the schema to check
 * @returns one line per problem, `"<schema pointer>: <problem>"`; empty when
 *   the schema is inside the supported subset
 */
export function schemaProblems(schema: unknown): string[] {
  const problems: string[] = [];
  walkSchema(schema, "", problems);
  return problems;
}

function walkSchema(schema: unknown, pointer: string, out: string[]): void {
  if (!isRecord(schema)) {
    // Boolean schemas (`true` / `false`) are legal JSON Schema but unused by
    // the plugin's schemas, so they are not part of the subset either.
    out.push(`${at(pointer)}: a schema must be an object`);
    return;
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(keyword)) continue;
    const here = child(pointer, keyword);
    if (!SUPPORTED.has(keyword)) {
      out.push(`${at(pointer)}: unsupported keyword "${keyword}"`);
      continue;
    }
    switch (keyword) {
      case "type": {
        const names = Array.isArray(value) ? value : [value];
        if (
          names.length === 0 ||
          !names.every((n) => typeof n === "string" && TYPE_NAMES.has(n))
        ) {
          out.push(`${here}: not a type name or a list of type names`);
        }
        break;
      }
      case "enum":
        if (!Array.isArray(value)) out.push(`${here}: must be an array`);
        break;
      case "minLength":
      case "maxLength":
      case "minItems":
      case "maxItems":
        if (!isCount(value)) {
          out.push(`${here}: must be a non-negative integer`);
        }
        break;
      case "minimum":
      case "maximum":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          out.push(`${here}: must be a finite number`);
        }
        break;
      case "pattern":
        if (typeof value !== "string" || compilePattern(value) === undefined) {
          out.push(`${here}: not a valid regular expression`);
        }
        break;
      case "required":
        if (
          !Array.isArray(value) ||
          !value.every((name) => typeof name === "string")
        ) {
          out.push(`${here}: must be an array of property names`);
        }
        break;
      case "properties":
        if (!isRecord(value)) {
          out.push(`${here}: must be an object`);
        } else {
          for (const [name, sub] of Object.entries(value)) {
            walkSchema(sub, child(here, name), out);
          }
        }
        break;
      case "items":
        walkSchema(value, here, out);
        break;
      case "additionalProperties":
        if (typeof value !== "boolean") walkSchema(value, here, out);
        break;
      // `const` takes any value.
    }
  }
}

/**
 * Throw `ConfigurationError` unless `schema` is inside the supported subset.
 * A schema that passes is remembered, so the walk runs once per schema object.
 *
 * @param schema - the schema to check
 * @throws ConfigurationError listing every problem
 */
export function assertSupportedSchema(schema: JsonSchema): void {
  if (checkedSchemas.has(schema)) return;
  const problems = schemaProblems(schema);
  if (problems.length > 0) {
    throw new ConfigurationError(
      `JSON Schema outside the validator's supported subset: ${problems.join("; ")}`,
      { problems },
    );
  }
  checkedSchemas.add(schema);
}

/** The JSON Schema type names `value` satisfies. */
function typesOf(value: unknown): readonly string[] {
  if (value === null) return ["null"];
  if (Array.isArray(value)) return ["array"];
  switch (typeof value) {
    case "string":
      return ["string"];
    case "boolean":
      return ["boolean"];
    case "number":
      if (!Number.isFinite(value)) return [];
      return Number.isInteger(value) ? ["integer", "number"] : ["number"];
    case "object":
      return ["object"];
    default:
      // `undefined`, functions, symbols, bigints: not JSON.
      return [];
  }
}

/** Equality of two JSON values, as `const` and `enum` define it. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
    );
  }
  return false;
}

function check(
  value: unknown,
  schema: Record<string, unknown>,
  pointer: string,
  out: string[],
): void {
  const types = typesOf(value);

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type)
      ? (schema.type as string[])
      : [schema.type as string];
    if (!allowed.some((name) => types.includes(name))) {
      out.push(
        `${at(pointer)}: expected type ${allowed.join(" or ")}, got ${types[0] ?? "a non-JSON value"}`,
      );
      // The remaining keywords would only repeat the same fault.
      return;
    }
  }
  if (Object.hasOwn(schema, "const") && !jsonEqual(value, schema.const)) {
    out.push(`${at(pointer)}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((option) => jsonEqual(value, option))
  ) {
    out.push(
      `${at(pointer)}: must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}`,
    );
  }

  if (typeof value === "string") checkString(value, schema, pointer, out);
  else if (typeof value === "number") checkNumber(value, schema, pointer, out);
  else if (Array.isArray(value)) checkArray(value, schema, pointer, out);
  else if (isRecord(value)) checkObject(value, schema, pointer, out);
}

function checkString(
  value: string,
  schema: Record<string, unknown>,
  pointer: string,
  out: string[],
): void {
  // JSON Schema counts characters as code points, not UTF-16 units.
  const length = [...value].length;
  if (typeof schema.maxLength === "number" && length > schema.maxLength) {
    out.push(
      `${at(pointer)}: longer than ${schema.maxLength} characters (${length})`,
    );
  }
  if (typeof schema.minLength === "number" && length < schema.minLength) {
    out.push(`${at(pointer)}: shorter than ${schema.minLength} characters`);
  }
  if (typeof schema.pattern === "string") {
    const re = compilePattern(schema.pattern);
    if (re !== undefined && !re.test(value)) {
      out.push(`${at(pointer)}: does not match the pattern ${schema.pattern}`);
    }
  }
}

function checkNumber(
  value: number,
  schema: Record<string, unknown>,
  pointer: string,
  out: string[],
): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    out.push(`${at(pointer)}: below the minimum ${schema.minimum}`);
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    out.push(`${at(pointer)}: above the maximum ${schema.maximum}`);
  }
}

function checkArray(
  value: readonly unknown[],
  schema: Record<string, unknown>,
  pointer: string,
  out: string[],
): void {
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    out.push(
      `${at(pointer)}: more than ${schema.maxItems} items (${value.length})`,
    );
  }
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    out.push(`${at(pointer)}: fewer than ${schema.minItems} items`);
  }
  if (isRecord(schema.items)) {
    const items = schema.items;
    value.forEach((element, index) => {
      check(element, items, child(pointer, index), out);
    });
  }
}

function checkObject(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  pointer: string,
  out: string[],
): void {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (Array.isArray(schema.required)) {
    for (const name of schema.required as string[]) {
      if (!Object.hasOwn(value, name)) {
        out.push(`${at(pointer)}: missing required property "${name}"`);
      }
    }
  }
  const extra = schema.additionalProperties;
  for (const [name, inner] of Object.entries(value)) {
    const declared = properties[name];
    if (isRecord(declared)) {
      check(inner, declared, child(pointer, name), out);
    } else if (extra === false) {
      out.push(
        `${at(pointer)}: property ${JSON.stringify(name)} is not allowed`,
      );
    } else if (isRecord(extra)) {
      check(inner, extra, child(pointer, name), out);
    }
  }
}

/**
 * Validate `value` against `schema`.
 *
 * Every broken rule is reported, not only the first, because the list goes
 * into the repair prompt (`docs/12` §18.3: "ERRORS:").
 *
 * @param value - a parsed JSON value
 * @param schema - a schema inside the supported subset
 * @returns `ok` and the list of broken rules
 * @throws ConfigurationError when `schema` uses a keyword outside the subset
 */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
): SchemaValidationResult {
  assertSupportedSchema(schema);
  const errors: string[] = [];
  check(value, schema, "", errors);
  return { ok: errors.length === 0, errors };
}

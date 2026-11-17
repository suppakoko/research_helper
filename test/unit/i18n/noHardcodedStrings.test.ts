/**
 * `P7-T03` steps 1–2 — no user-visible string outside Fluent (`docs/10`
 * NFR-11; `docs/08` §10).
 *
 * - **The documents.** Every `addon/content/*.xhtml` is read. An element with
 *   visible text, or with a `label`, `placeholder`, `tooltiptext`, `title`,
 *   `aria-label` or `alt` attribute holding a letter — or a `value` on a
 *   button, label or description — fails unless the element carries a
 *   `data-l10n-id`.
 * - **The code.** Every `src/ui/**` TypeScript file and every
 *   `addon/content/*.js` is read for an assignment to `textContent`,
 *   `innerText`, `innerHTML`, `label`, `title`, `placeholder` or `tooltipText`
 *   from a string literal holding a letter, and for a `setAttribute` of one of
 *   those attributes to such a literal. A template literal's `${…}` parts are
 *   not text. `.value` is not searched: on an input or a menu list it is a
 *   machine value (`dates.value = "recorded"`), and a button's `value` is a
 *   document attribute, which the first scan covers.
 *
 * {@link ALLOWED} is the list of non-language text, each with its reason
 * (coordinator, 2026-11-17, under `plan/00` §6 item 313). Each scanner is also
 * run over fixture strings with a planted literal, so a scanner that finds
 * nothing fails (`Done when` 1).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LETTER = /\p{L}/u;

/** A finding, as `<file>: <what>`; the allow-list matches it exactly. */
type Finding = string;

/**
 * Non-language text, each with its reason. A key is a finding exactly as the
 * scanners write it.
 */
const ALLOWED: ReadonlyMap<Finding, string> = new Map([
  // Provider names are product names, shown as written in every locale
  // (`docs/08` §10.3: names are data, never translated).
  [
    'addon/content/preferences.xhtml: label on <menuitem>: "OpenRouter"',
    "a provider's product name",
  ],
  [
    'addon/content/preferences.xhtml: label on <menuitem>: "OpenAI"',
    "a provider's product name",
  ],
  [
    'addon/content/preferences.xhtml: label on <menuitem>: "Google Gemini"',
    "a provider's product name",
  ],
  [
    'addon/content/preferences.xhtml: label on <menuitem>: "Anthropic"',
    "a provider's product name",
  ],
  // Each base-URL field's placeholder is the default address it falls back to
  // (`src/llm/shared/baseUrl.ts`'s `DEFAULT_BASE_URLS`): a URL, not language.
  [
    'addon/content/preferences.xhtml: placeholder on <html:input id="rh-or-base-url">: "https://openrouter.ai/api/v1"',
    "a URL",
  ],
  [
    'addon/content/preferences.xhtml: placeholder on <html:input id="rh-openai-base-url">: "https://api.openai.com/v1"',
    "a URL",
  ],
  [
    'addon/content/preferences.xhtml: placeholder on <html:input id="rh-gemini-base-url">: "https://generativelanguage.googleapis.com"',
    "a URL",
  ],
  [
    'addon/content/preferences.xhtml: placeholder on <html:input id="rh-anthropic-base-url">: "https://api.anthropic.com"',
    "a URL",
  ],
]);

/** Attributes whose text the user sees. */
const VISIBLE_ATTRIBUTES = [
  "label",
  "placeholder",
  "tooltiptext",
  "title",
  "aria-label",
  "alt",
] as const;

/** Elements whose `value` is drawn as text. */
const VALUE_SHOWN_ON = new Set([
  "button",
  "html:button",
  "label",
  "description",
]);

/** Elements whose text is not drawn as language. */
const TEXT_NOT_SHOWN_IN = new Set(["script", "style", "html:style"]);

interface OpenElement {
  readonly name: string;
  readonly localized: boolean;
}

/**
 * Step 1's scan of one document.
 *
 * @param file - the path the findings name
 * @param text - the document
 */
function scanDocument(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  // Comments and processing instructions are blanked, keeping offsets.
  const body = text
    .replace(/<!--[\s\S]*?-->/gu, (m) => m.replace(/[^\n]/gu, " "))
    .replace(/<\?[\s\S]*?\?>/gu, (m) => m.replace(/[^\n]/gu, " "))
    .replace(/<!DOCTYPE[\s\S]*?>/giu, (m) => m.replace(/[^\n]/gu, " "));
  const token =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[[\s\S]*?\]\]>|([^<]+)/gu;
  const open: OpenElement[] = [];
  for (const m of body.matchAll(token)) {
    const [, close, name, attributeText, selfClosing, textNode] = m;
    if (textNode !== undefined) {
      const parent = open[open.length - 1];
      const shown = textNode.replace(/&[a-z]+;|&#\d+;/giu, "").trim();
      if (
        parent !== undefined &&
        !parent.localized &&
        !TEXT_NOT_SHOWN_IN.has(parent.name) &&
        LETTER.test(shown)
      ) {
        findings.push(`${file}: text in <${parent.name}>: "${shown}"`);
      }
      continue;
    }
    if (name === undefined) continue;
    if (close === "/") {
      open.pop();
      continue;
    }
    const attributes = new Map<string, string>();
    for (const a of (attributeText ?? "").matchAll(
      /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu,
    )) {
      attributes.set(a[1] ?? "", a[2] ?? a[3] ?? "");
    }
    const localized = attributes.has("data-l10n-id");
    const id = attributes.get("id");
    const where = id === undefined ? `<${name}>` : `<${name} id="${id}">`;
    const checked: string[] = [...VISIBLE_ATTRIBUTES];
    if (VALUE_SHOWN_ON.has(name)) checked.push("value");
    for (const attribute of checked) {
      const value = attributes.get(attribute);
      if (value !== undefined && LETTER.test(value) && !localized) {
        findings.push(`${file}: ${attribute} on ${where}: "${value}"`);
      }
    }
    if (selfClosing !== "/") open.push({ name, localized });
  }
  return findings;
}

const LITERAL =
  String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`)";
const ASSIGNMENT = new RegExp(
  String.raw`\.(textContent|innerText|innerHTML|label|title|placeholder|tooltipText)\s*=\s*` +
    LITERAL,
  "u",
);
const SET_ATTRIBUTE = new RegExp(
  String.raw`setAttribute\(\s*["'](label|title|placeholder|tooltiptext|aria-label)["']\s*,\s*` +
    LITERAL,
  "u",
);

/**
 * Step 2's scan of one script.
 *
 * @param file - the path the findings name
 * @param text - the source
 */
function scanCode(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      return;
    }
    for (const pattern of [ASSIGNMENT, SET_ATTRIBUTE]) {
      const m = pattern.exec(line);
      const literal = m?.[2];
      if (literal === undefined) continue;
      const shown = literal.slice(1, -1).replace(/\$\{[^}]*\}/gu, "");
      if (LETTER.test(shown)) {
        findings.push(`${file}:${String(index + 1)}: ${trimmed}`);
      }
    }
  });
  return findings;
}

function filesUnder(dir: string, suffix: string): string[] {
  return readdirSync(resolve(ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) =>
      relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .sort();
}

const read = (file: string): string =>
  readFileSync(resolve(ROOT, file), "utf8");

describe("no hard-coded user-visible string (P7-T03, NFR-11)", () => {
  const documents = filesUnder("addon/content", ".xhtml");
  const scripts = [
    ...filesUnder("src/ui", ".ts"),
    ...filesUnder("addon/content", ".js"),
  ];

  it("reads the documents and scripts it means to", () => {
    expect(documents).toContain("addon/content/preferences.xhtml");
    expect(documents).toContain("addon/content/reportWindow.xhtml");
    expect(documents.length).toBeGreaterThanOrEqual(6);
    expect(scripts).toContain("src/ui/panes/summarySection.ts");
    expect(scripts).toContain("addon/content/preferences.js");
  });

  it("finds no element with visible text and no data-l10n-id outside the allow-list", () => {
    const findings = documents.flatMap((file) =>
      scanDocument(file, read(file)),
    );
    expect(findings.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });

  it("finds no literal with a letter assigned to visible text in code", () => {
    const findings = scripts.flatMap((file) => scanCode(file, read(file)));
    expect(findings.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });

  it("keeps every allow-list entry live, each with a reason", () => {
    const all = new Set([
      ...documents.flatMap((file) => scanDocument(file, read(file))),
      ...scripts.flatMap((file) => scanCode(file, read(file))),
    ]);
    for (const [finding, reason] of ALLOWED) {
      expect(all.has(finding), finding).toBe(true);
      expect(reason.length, finding).toBeGreaterThan(0);
    }
  });
});

describe("the scanners fail on a planted literal (Done when 1)", () => {
  it("finds visible text, each visible attribute, and a button's value", () => {
    const planted = [
      "<vbox><html:p>Planted words</html:p></vbox>",
      '<button label="Planted"/>',
      '<html:input placeholder="Type here"/>',
      '<toolbarbutton tooltiptext="Planted tip"/>',
      '<html:a title="Planted title"/>',
      '<html:button aria-label="Planted name"/>',
      '<html:img alt="Planted picture"/>',
      '<html:button value="Planted"/>',
      '<label value="Planted"/>',
    ];
    for (const fixture of planted) {
      expect(scanDocument("fixture.xhtml", fixture), fixture).toHaveLength(1);
    }
  });

  it("passes what is localized, machine-shaped or not drawn", () => {
    const clean = [
      '<html:p data-l10n-id="research-helper-x"/>',
      '<button data-l10n-id="research-helper-x" label="Fallback"/>',
      '<html:p data-l10n-id="research-helper-x">Fallback</html:p>',
      "<html:p>12 345</html:p>",
      "<html:p>·</html:p>",
      "<script>const label = 'x';</script>",
      "<!-- a comment with words -->",
      '<html:input value="recorded"/>',
      "<html:p>&#8212;&amp;</html:p>",
    ];
    for (const fixture of clean) {
      expect(scanDocument("fixture.xhtml", fixture), fixture).toEqual([]);
    }
  });

  it("finds a literal assigned in code, and passes ids, values and placeholders", () => {
    const planted = [
      'el.textContent = "Planted";',
      "el.title = 'Planted';",
      "el.label = `Planted ${n}`;",
      'el.innerHTML = "<b>Planted</b>";',
      'el.placeholder = "Planted";',
      'button.tooltipText = "Planted";',
      'el.setAttribute("label", "Planted");',
      "el.setAttribute('aria-label', 'Planted');",
    ];
    for (const fixture of planted) {
      expect(scanCode("fixture.ts", fixture), fixture).toHaveLength(1);
    }
    const clean = [
      'el.textContent = "";',
      "el.textContent = `${count}`;",
      'el.textContent = " · ";',
      'dates.value = "recorded";',
      'el.setAttribute("data-l10n-id", "research-helper-x");',
      '// el.textContent = "in a comment";',
      ' * el.textContent = "in a doc comment";',
      "el.textContent = message;",
    ];
    for (const fixture of clean) {
      expect(scanCode("fixture.ts", fixture), fixture).toEqual([]);
    }
  });
});

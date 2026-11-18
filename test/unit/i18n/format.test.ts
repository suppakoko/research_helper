/**
 * `P7-T03` step 4 — `src/i18n/format.ts`, the one formatter of every date,
 * amount, count, duration and size the UI shows (`docs/10` NFR-11;
 * `docs/08` §10.3). Node's `Intl` carries full ICU, so both shipped locales
 * are checked here; the expected strings are Node 22's.
 *
 * The inventory test pins where `Intl` is still called outside this module:
 * `addon/content/preferences.js`'s three helpers, which a chrome script keeps
 * because it cannot import the bundle (coordinator, 2026-11-17, under
 * `plan/00` §6 item 313).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatList,
  formatMinutes,
  formatNumber,
  formatUsd,
} from "../../../src/i18n/format";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Narrow no-break and no-break spaces, which ICU puts in some outputs. */
const plain = (text: string): string =>
  text.replace(new RegExp("[\\u202f\\u00a0]", "gu"), " ");

describe("formatUsd", () => {
  it("prints dollars with two decimals, and four under one cent", () => {
    expect(formatUsd(1234.5, "en-US")).toBe("$1,234.50");
    expect(formatUsd(0, "en-US")).toBe("$0.00");
    expect(formatUsd(0.004, "en-US")).toBe("$0.004");
    expect(formatUsd(0.00456, "en-US")).toBe("$0.0046");
    expect(formatUsd(0.01, "en-US")).toBe("$0.01");
    expect(formatUsd(0.009999, "en-US")).toBe("$0.01");
    expect(formatUsd(-0.004, "en-US")).toBe("-$0.00");
    expect(formatUsd(1234.5, "ko-KR")).toBe("US$1,234.50");
  });
});

describe("formatNumber", () => {
  it("groups for the locale and keeps no decimals", () => {
    expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
    expect(formatNumber(1234567, "ko-KR")).toBe("1,234,567");
    expect(formatNumber(12.6, "en-US")).toBe("13");
    expect(formatNumber(1234567, "de-DE")).toBe("1.234.567");
  });
});

describe("formatList", () => {
  it("joins names as a list for the locale", () => {
    expect(formatList(["a", "b", "c"], "en-US")).toBe("a, b, and c");
    expect(formatList(["a"], "en-US")).toBe("a");
    expect(formatList(["a", "b"], "en-US")).toBe("a and b");
    expect(formatList(["a", "b"], "ko-KR")).toBe("a 및 b");
  });
});

describe("formatMinutes", () => {
  it("prints whole minutes, at least one", () => {
    expect(formatMinutes(600, "en-US")).toBe("10 minutes");
    expect(formatMinutes(60, "en-US")).toBe("1 minute");
    expect(formatMinutes(5, "en-US")).toBe("1 minute");
    expect(formatMinutes(0, "en-US")).toBe("1 minute");
    expect(formatMinutes(89, "en-US")).toBe("1 minute");
    expect(formatMinutes(90, "en-US")).toBe("2 minutes");
    expect(formatMinutes(600, "ko-KR")).toBe("10분");
  });
});

describe("formatBytes", () => {
  it("prints decimal megabytes with one decimal", () => {
    expect(formatBytes(28_800_000, "en-US")).toBe("28.8 MB");
    expect(formatBytes(28_840_000, "en-US")).toBe("28.8 MB");
    expect(formatBytes(1_000_000, "en-US")).toBe("1 MB");
    expect(formatBytes(28_800_000, "ko-KR")).toBe("28.8MB");
  });
});

describe("formatDate", () => {
  it("prints the UTC calendar date", () => {
    // 23:30 UTC is the next day east of UTC; the date stays the UTC one.
    const late = Date.UTC(2026, 10, 17, 23, 30);
    expect(formatDate(late, "en-US")).toBe("Nov 17, 2026");
    expect(formatDate(Date.UTC(2026, 0, 1), "ko-KR")).toBe("2026. 1. 1.");
  });
});

describe("formatDateTime", () => {
  it("prints the date and time in the user's zone, and the ISO form when Intl refuses", () => {
    const at = Date.UTC(2026, 10, 17, 12, 5);
    const local = plain(formatDateTime(at, "en-US"));
    expect(local).toMatch(/^Nov 1[78], 2026, \d{1,2}:\d{2} [AP]M$/u);
    expect(plain(formatDateTime(at, "ko-KR"))).toMatch(
      // Node 22 here printed "PM" for ko-KR's day period, measured
      // 2026-11-17; Zotero's ICU may print "오후". Either is Intl's.
      /^2026\. 11\. 1[78]\. (오전|오후|AM|PM) \d{1,2}:\d{2}$/u,
    );
    expect(formatDateTime(at, "not a locale!")).toBe(
      "2026-11-17T12:05:00.000Z",
    );
  });
});

describe("where Intl is called (P7-T03 step 4)", () => {
  /** Every source file of the plugin: src/**.ts and addon/content/*.js. */
  const sources = [
    ...readdirSync(resolve(ROOT, "src"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => join(e.parentPath, e.name)),
    ...readdirSync(resolve(ROOT, "addon/content"), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => join(e.parentPath, e.name)),
  ];

  it("calls an Intl formatter only in format.ts and preferences.js's three helpers", () => {
    const calls = new Map<string, number>();
    for (const path of sources) {
      const file = relative(ROOT, path).replaceAll("\\", "/");
      const code = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
        .join("\n");
      const n = (
        code.match(
          /new Intl\.(NumberFormat|DateTimeFormat|ListFormat|RelativeTimeFormat|PluralRules)\(|\.toLocale(Date|Time)?String\(/gu,
        ) ?? []
      ).length;
      if (n > 0) calls.set(file, n);
    }
    expect(Object.fromEntries(calls)).toEqual({
      "addon/content/preferences.js": 3,
      "src/i18n/format.ts": 7,
    });
  });

  /**
   * The named exception to `P7-T03`'s Do NOT ("no `NUMBER()` options the
   * plugin cannot test in Node"): the preferences pane's megabyte figures,
   * `NUMBER($megabytes, maximumFractionDigits: 1)`, stay in Fluent, because
   * their Korean is approved and the pane's integration spec checks their
   * output in Zotero. DECIDED 2026-11-18 (owner, plan/00 §6 item 399(c),
   * "그대로 둠"). Any other `NUMBER()` in a bundle fails here.
   */
  it("uses Fluent NUMBER() only in the four pane messages the owner kept (item 399(c))", () => {
    const uses: Record<string, Record<string, number>> = {};
    for (const locale of ["en-US", "ko-KR"]) {
      const dir = resolve(ROOT, "addon/locale", locale);
      for (const name of readdirSync(dir).filter((n) => n.endsWith(".ftl"))) {
        let id = "";
        for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
          const head = /^([a-z][a-z0-9-]*) =/u.exec(line);
          if (head?.[1] !== undefined) id = head[1];
          if (line.startsWith("#")) continue;
          const n = (line.match(/NUMBER\(/gu) ?? []).length;
          if (n === 0) continue;
          const key = `${name} ${id}`;
          uses[locale] ??= {};
          uses[locale][key] = (uses[locale][key] ?? 0) + n;
        }
      }
    }
    const kept = {
      "research-helper-mainWindow.ftl research-helper-prefs-cache-usage-row": 1,
      "research-helper-mainWindow.ftl research-helper-prefs-cache-usage-total": 1,
      "research-helper-mainWindow.ftl research-helper-prefs-confirm-delete-all": 1,
    };
    expect(uses).toEqual({
      // The English has one placeable per plural variant of the
      // cached-responses confirmation; the Korean has no plural variant.
      "en-US": {
        ...kept,
        "research-helper-mainWindow.ftl research-helper-prefs-confirm-clear-responses": 2,
      },
      "ko-KR": {
        ...kept,
        "research-helper-mainWindow.ftl research-helper-prefs-confirm-clear-responses": 1,
      },
    });
    for (const placeable of readFileSync(
      resolve(ROOT, "addon/locale/en-US/research-helper-mainWindow.ftl"),
      "utf8",
    ).match(/NUMBER\([^)]*\)/gu) ?? []) {
      expect(placeable).toBe("NUMBER($megabytes, maximumFractionDigits: 1)");
    }
  });
});

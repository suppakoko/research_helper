/**
 * The word list behind `docs/06` §4.1 step 8's stray-space split share
 * (decided 2026-10-25, owner, `plan/00` §6 item 285(b)).
 *
 * The probe is defined by the measurement that chose it (item 283(b)), and
 * that measurement's word list was Zotero's own en-US Hunspell dictionary with
 * its affixes expanded. {@link expandHunspellWordList} is that expansion, rule
 * for rule, so the product counts exactly what was measured: every stem, each
 * suffix form its flags allow, and each prefix form (on the stem, and on the
 * suffix forms when the prefix class allows cross products), all lower-cased.
 * It deliberately does **not** implement the rest of Hunspell — no second
 * level of affixes, no compound rules, no `KEEPCASE` / `NOSUGGEST` /
 * `ONLYINCOMPOUND` handling — because the measurement did not, and a fuller
 * reading would move the numbers the threshold was chosen on.
 *
 * The plugin ships no word list. The platform port reads the two files from
 * Zotero's `omni.ja` (`readEnglishDictionary`, `src/zotero/fulltext.ts`), and
 * `acquireSource` expands them once per session.
 *
 * Pure: no platform call, no preference read.
 */

/** Lower-cased word forms. */
export type WordList = ReadonlySet<string>;

interface AffixRule {
  readonly strip: string;
  readonly add: string;
  readonly cond: RegExp;
}

interface AffixClass {
  readonly cross: boolean;
  readonly rules: AffixRule[];
}

/**
 * Expand a Hunspell `.aff` / `.dic` pair into lower-cased word forms, as the
 * item 283(b) measurement did (module note).
 *
 * @param aff - the affix file's text
 * @param dic - the dictionary file's text; its first line is the entry count
 */
export function expandHunspellWordList(aff: string, dic: string): Set<string> {
  const suffixes = new Map<string, AffixClass>();
  const prefixes = new Map<string, AffixClass>();
  for (const line of aff.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    const [kind, flag = "", third = "", fourth = "", fifth = ""] = parts;
    if (kind !== "SFX" && kind !== "PFX") continue;
    const table = kind === "SFX" ? suffixes : prefixes;
    if (parts.length === 4) {
      table.set(flag, { cross: third === "Y", rules: [] });
    } else if (parts.length >= 5) {
      const strip = third === "0" ? "" : third;
      const add = (fourth === "0" ? "" : fourth).split("/")[0] ?? "";
      const body = fifth === "." ? "" : fifth;
      const cond =
        kind === "SFX"
          ? new RegExp(`${body}$`, "u")
          : new RegExp(`^${body}`, "u");
      table.get(flag)?.rules.push({ strip, add, cond });
    }
  }

  const words = new Set<string>();
  for (const entry of dic.split(/\r?\n/u).slice(1)) {
    if (entry === "") continue;
    const [stem = "", flags = ""] = entry.split("/");
    const forms = [stem];
    const suffixForms: string[] = [];
    for (const flag of flags) {
      const suffix = suffixes.get(flag);
      if (suffix === undefined) continue;
      for (const rule of suffix.rules) {
        if (rule.cond.test(stem) && stem.endsWith(rule.strip)) {
          suffixForms.push(
            stem.slice(0, stem.length - rule.strip.length) + rule.add,
          );
        }
      }
    }
    forms.push(...suffixForms);
    for (const flag of flags) {
      const prefix = prefixes.get(flag);
      if (prefix === undefined) continue;
      for (const rule of prefix.rules) {
        for (const base of [stem, ...(prefix.cross ? suffixForms : [])]) {
          if (rule.cond.test(base)) {
            forms.push(rule.add + base.slice(rule.strip.length));
          }
        }
      }
    }
    for (const form of forms) words.add(form.toLowerCase());
  }
  return words;
}

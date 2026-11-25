# Korean review: three new search-window sentences (P1-T38, batch L)

**Status:** written by the batch L executor on 2026-11-25. **It holds no Korean text.** The
brief for batch L says the executor writes no Korean, so this file gives the coordinator what a
draft needs: each new message id, its English, its arguments, where it shows, and the controls
whose Korean wording it should match. The coordinator writes the Korean drafts and puts them to
the owner in chat (`G-41`). Only the owner approves them.

**Where the ids stand today.** All three are in `addon/locale/en-US/research-helper-searchDialog.ftl`,
and none is in `addon/locale/ko-KR/research-helper-searchDialog.ftl`, which carries a comment
naming them. Each is on `KO_PENDING_REVIEW` in `src/i18n/keys.ts`. CI's l10n step passes each
with `--allow` (`.github/workflows/ci.yml`). Until the Korean is in the bundle, a ko-KR window
shows the English sentence through Fluent's fallback to en-US.

When the owner has approved a sentence, three edits make it live:

1. add the Korean message to the ko-KR bundle;
2. move the id from `KO_PENDING_REVIEW` to `KO_PRESENT`;
3. drop its `--allow` from CI's step.

## The three ids

| Id | English (en-US) | Arguments | Where it shows |
|---|---|---|---|
| `research-helper-search-query-empty` | Enter a keyword to search. | none | The error panel's headline, when Search runs with an empty keyword. |
| `research-helper-search-max-results-range` | Set Max per database to a whole number from { $min } to { $max }. | `$min`, `$max`: numbers, the preference's range (today 10 and 200, read from `PREFS.maxResults` in `src/prefs/schema.ts`) | The error panel's headline, when "Max per database" is out of range. |
| `research-helper-search-target-missing` | Choose a collection to import into. | none | The inline warning banner above the results, when an import names no collection. |

## Controls each sentence names or echoes

The Korean should use the same words as the controls the sentence points at. Their ids, in the
ko-KR bundle:

- `research-helper-search-query-empty`: the keyword box, `research-helper-search-keyword-label` and
  `research-helper-search-keyword-input`. Its tone follows `research-helper-search-databases-none`.
- `research-helper-search-max-results-range`: the "Max per database" box,
  `research-helper-search-max-results-label`. The sentence names that label, so the Korean should
  repeat the ko-KR label as it is.
- `research-helper-search-target-missing`: the "Import into" row, `research-helper-search-target-label`
  and `research-helper-search-target-picker`. Its tone also follows
  `research-helper-search-databases-none`.

## Questions for the owner with the drafts

- `research-helper-search-max-results-range` places two numbers in the sentence. Korean word order
  may put them before the verb. Fluent allows any order, so nothing in the code needs to change for
  that.

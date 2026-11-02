# Trend report evaluation — baseline (`P4-T23`)

> **What this file is.** Where `plan/07-phase-4-trend-report.md` `P4-T23` records the baseline
> evaluation scores, the actual spend, and the two measurements of its step 4.
>
> **No run has happened yet, so this file holds no scores** (2026-11-02). The card has stopped at gate
> `G-23`: the owner has not yet supplied the three collections and their expected themes. After that
> comes gate `G-42`, where the estimate for the paid run is stated and the owner approves it.

## How a score is produced

The format, the route and the scoring are in `docs/06-summarization-and-trend-report.md` §12.3's notes
of 2026-11-02. With Zotero closed:

```sh
npx tsx scripts/eval-trend-report.ts sheet --set test/fixtures/trend-eval/<set>/expected-themes.json --database <data directory>/research-helper.sqlite --out <file outside the repository>
npx tsx scripts/eval-trend-report.ts score --set test/fixtures/trend-eval/<set>/expected-themes.json --database <data directory>/research-helper.sqlite --matches <the review page's export> --report <run id>
```

The first writes what the review page shows the owner. The second prints the scores that go here.

## Scores

None yet.

## Actual spend

None yet.

## Step 4: reasoning share of each ceiling, and `THEME_CLUSTER`'s tokens per paper

Not measured. **Open, 2026-11-02:** the stored record cannot supply these. `Usage` holds
`inputTokens`, `outputTokens`, `totalTokens` and `costUsd`, with no reasoning figure, and
`TrendReport.usage` is a sum over the run, not a per-call figure. See the card's note of this date.

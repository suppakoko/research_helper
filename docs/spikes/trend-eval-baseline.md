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
Step 4's numbers and the actual spend come from the `measure` command below, which needs no expected themes.

## Scores

None yet.

## Actual spend

None yet.

## Step 4: reasoning share of each ceiling, and `THEME_CLUSTER`'s tokens per paper

Not measured yet, because no run has happened. **The source exists since 2026-11-02** (owner, `plan/00` §6 item
335(k); `docs/07` §5.2's note of this date). After the paid run, with Zotero closed:

```sh
npx tsx scripts/eval-trend-report.ts measure --database <data directory>/research-helper.sqlite --report <report id>
```

It prints numbers and identifiers only: per prompt and per call the tokens, the reasoning figure as a share of that call's
ceiling, `THEME_CLUSTER`'s answer tokens per paper against the 40 its ceiling assumes, each theme analysis's size (which
`P4-T25` reads), and the run's totals. A `both` run's shared stages are counted once. "not reported" means the provider gave no such figure, and "not
measured" means the record predates the source; neither is 0.

**The route was run on 2026-11-02, on a mock provider and no paid call:** in real Zotero 10.0.3, then `measure` on a copy of the
database after the test harness quit Zotero, in three consecutive runs. `docs/07` §5.2's note of that date has the figures. They
are the mock's, so none of them belongs in this section.

**One check when copying the figures here:** no recorded response has held a reasoning figure, so if a reasoning model shows
"not reported" on every call, the adapter's field name is wrong for that provider, and that is a defect to report, not a measurement.

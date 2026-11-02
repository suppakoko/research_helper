# research_helper — strings for the report window.
#
# `docs/08` §10.1 owns the surface list; this is the **reportWindow** surface —
# `addon/content/reportWindow.xhtml` (`P4-T19`). It earns its own file because
# it owns a *window*: its own document, its own `<linkset>`, and it can be open
# while the main window is not. The menu entry that opens it,
# `research-helper-menu-collection-report`, is a main-window string and lives
# in research-helper-mainWindow.ftl.
#
# Flat under `locale/en-US/`, plugin-unique filename, every identifier
# prefixed `research-helper-` — `docs/01` §9.1 and §9.3.
#
# ## The attribute each entry sets
#
# | Element | Attribute set here |
# |---|---|
# | XUL `<label>` caption | `.value` |
# | `<menuitem>`, the dialog's button | `.label` |
# | panel prose and status text | the message value itself, no attribute |
#
# The window title and the dialog's Close button label are attributes XUL
# carries outside Fluent's reach (`title`, `buttonlabelcancel`), so
# `reportWindow.js` formats them and sets them itself, as `searchDialog.js`
# does.
#
# Every wording here is provisional (`G-41`); the owner reviewed the Korean of
# these ten on 2026-10-29 (plan/00 §6 item 307(f)), so they are on `KO_PRESENT`
# in `src/i18n/keys.ts`, and a new string goes on `KO_PENDING_REVIEW` until its
# Korean is reviewed. `P4-T20` adds the stage rows,
# the preview and the delivery buttons to this file.

## The window's chrome (docs/08 §6.4's wireframe title)

research-helper-report-title = Research Helper — Collection Report

# `$name` is the collection's name, the user's own text; `$count` is its
# regular items, not in the trash.
research-helper-report-collection =
    { $count ->
        [one] { $name } — 1 paper
       *[other] { $name } — { $count } papers
    }

## The per-run language override (docs/08 §6.4, §10.4). The four values are
## `reportLanguage`'s (docs/07 §8.5); the choice is never written back to the
## preference. "English" and "한국어" are each language's own name, as
## docs/08 §7.3's preference markup draws them.

research-helper-report-language-label =
    .value = Language
research-helper-report-language-auto =
    .label = Same as Zotero's language
research-helper-report-language-en =
    .label = English
research-helper-report-language-ko =
    .label = 한국어
research-helper-report-language-both =
    .label = English and Korean

## P4-T21: which report of a two-report run the preview, Export, Copy and Save as
## note act on (docs/08 §6.3's note of 2026-11-02). Its items are the two
## language entries above. Korean pending review (G-41).

research-helper-report-shown-label =
    .value = Report shown

## The resolved report model, as text (owner, 2026-10-26, plan/00 §6 item
## 286): no per-run model choice and no Depth control. `$model` is a model id
## and `$provider` a provider's name; neither is translated (docs/08 §10.3).

research-helper-report-model = Model: { $model } ({ $provider }) — set in Research Helper's preferences.
research-helper-report-model-none = No report model is set. Choose an AI provider and its model in Research Helper's preferences.

## The dialog's button

research-helper-report-close =
    .label = Close

## P4-T20: the run (docs/08 §6.1–§6.4 and their notes of 2026-11-01). The
## stage rows, the streamed preview's label, the outcome, the delivery buttons
## and their results. Lines the main window already owns (a stop's reason, the
## wall-clock pause, the skipped-dialog cost line) are formatted from that
## bundle by the window's host and placed as text, so this window links only
## its own file (docs/08 §10.1).

research-helper-report-generate =
    .label = Generate report
research-helper-report-cancel =
    .label = Cancel
research-helper-report-save-note =
    .label = Save as note
research-helper-report-export =
    .label = Export Markdown…
research-helper-report-copy =
    .label = Copy
research-helper-report-continue =
    .label = Continue
research-helper-report-stop =
    .label = Stop
research-helper-report-group-save =
    .label = Save in the group
research-helper-report-group-skip =
    .label = Don't save

# `$stage` is a token, never displayed.
research-helper-report-stage =
    { $stage ->
        [reading] Reading the collection…
        [confirming] Waiting for your confirmation…
        [summaries] Summarizing papers…
        [themes] Finding and analysing themes…
        [writing] Writing the report…
        [reviewing] Reviewing the draft…
        [finishing] Adding tables and references, and saving…
        [waiting] Paused — waiting for your answer.
       *[done] Done.
    }

## The stage rows. Each row is one stage of the run; the window marks it as
## waiting, running or done.

research-helper-report-row-reading = Read the collection and estimate the cost
research-helper-report-row-summaries = Summaries: { $made } new and { $cached } from the cache, of { $toMake } to make; { $failed } failed
research-helper-report-row-themes = Themes: { $done } of { $total } analysed
research-helper-report-row-writing = Write the report
# `$round` is 0 until the review asks for a revision.
research-helper-report-row-review =
    { $round ->
        [0] Review the draft
       *[other] Review the draft — revision { $round }
    }
research-helper-report-row-finishing = Add tables and references, and save

# `$cost` is already formatted as US dollars.
research-helper-report-spend = Spent so far in this run: { $cost }

# `$state` is a token, never displayed.
research-helper-report-preview-label =
    { $state ->
        [draft] Draft — the text may still change
        [final] The report
       *[discarded] The draft was discarded; nothing was saved.
    }

# `$outcome` is a token, never displayed.
research-helper-report-outcome =
    { $outcome ->
        [succeeded] Report ready.
        [cancelled] Cancelled. The report was discarded; every summary already made is kept.
        [declined] Nothing was sent.
        [interrupted] Zotero is closing. The run will continue from where it stopped the next time Zotero starts.
        [unavailable] The collection or the report run is not available.
       *[failed] The report could not be generated. Every summary already made is kept.
    }

# `$state` is a token, never displayed.
research-helper-report-note =
    { $state ->
        [written] Saved as a note in this collection.
        [export-only] This library cannot be written to, so no note was saved. Use Export Markdown or Copy.
        [no-collection] The collection is gone, so no note was saved. Use Export Markdown or Copy.
        [declined] Not saved in the group library.
        [off] Not saved as a note.
       *[failed] The note could not be saved.
    }

# `$group` is the group library's name, the user's own text.
research-helper-report-group-question = Save this report as a note in the group library “{ $group }”? Everyone in the group will be able to read it.

# `$outcome` is a token, never displayed.
research-helper-report-export-outcome =
    { $outcome ->
        [written] Exported.
        [invalid-report] The report could not be exported: its citations and references do not agree.
       *[failed] The file could not be written.
    }
research-helper-report-copied = Copied to the clipboard.

# `$provider` is a provider's name, not translated (docs/08 §10.3).
research-helper-report-key-needed = No API key for { $provider } is available. Add it in Research Helper's preferences, then press Continue. Everything done so far is kept.

# `$reason` is a pause reason token, never displayed.
research-helper-report-paused-job =
    { $reason ->
        [budget-stop] A report run for this collection was paused at a spending limit.
        [awaiting-confirmation] A report run for this collection was paused until you confirm what the rest will cost.
        [egress-unacknowledged] A report run for this collection was paused until you confirm where its data is sent.
        [credential-required] A report run for this collection was paused because no API key was available.
        [wall-clock-budget] A report run for this collection was paused at its time limit.
       *[other] A report run for this collection was paused.
    } Everything it had done is kept. Continue it, or stop it?

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
# Every wording here is provisional (`G-41`); its Korean is pending review
# (`KO_PENDING_REVIEW` in `src/i18n/keys.ts`). `P4-T20` adds the stage rows,
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

## The resolved report model, as text (owner, 2026-10-26, plan/00 §6 item
## 286): no per-run model choice and no Depth control. `$model` is a model id
## and `$provider` a provider's name; neither is translated (docs/08 §10.3).

research-helper-report-model = Model: { $model } ({ $provider }) — set in Research Helper's preferences.
research-helper-report-model-none = No report model is set. Choose an AI provider and its model in Research Helper's preferences.

## The dialog's button

research-helper-report-close =
    .label = Close

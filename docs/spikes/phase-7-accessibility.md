# Phase 7: keyboard, focus, accessible names and contrast (`P7-T06`)

> **Status, 2026-11-18.** `test/integration/accessibility.spec.ts` measured everything below in Zotero
> 10.0.3 on Windows 11, with the UI locale pinned to `en-US`. The figures are copied from that spec's
> `[P7-T06]` log lines, in the runs that `plan/reports/P7-T06.md` names.
>
> **What a screen reader announces is not in this file**, except as a procedure. That is the
> owner's NVDA run: `P7-T07`, gate `G-33`, procedure in §6. VoiceOver is waived for v1.0 (owner,
> `plan/00` §6 item 380, decision 1).

## 1. Keyboard and accessible names

**How the spec checks each window:**

- **Tab order.** Tab is pressed through the window with the focus manager's own forward move. Each
  enabled, shown control must be reached once, and must match `:focus-visible` when it is.
- **Names.** Each control must have a non-empty name. The spec computes the name from the
  markup's `aria-labelledby`, `aria-label`, `<label control>`/`<label for>`, the XUL `label`
  attribute, the element's text, `title`/`tooltiptext`, and a text field's placeholder (HTML-AAM's
  last source). The names come from the DOM, not from the platform's accessibility tree.
- **Escape and Enter.** These are real key presses, sent through `nsITextInputProcessor`. A press
  that would start a paid or networked run is caught by a stand-in for the window's own `start`
  or `search`, so nothing runs.

| Window | Controls | Tab order (name in quotes) | Escape | Enter |
|---|---|---|---|---|
| Search & Import (keyword mode) | 19 | keyword "Search keyword" → "Search" → "Earliest publication year" → "Latest publication year" → "Maximum results per database" → seven database boxes (PubMed … medRxiv) → link "Request a free API key" → "Filter the results already fetched" → "Hide items already in my library" → "Target collection" → "New collection…" → radio group "Duplicates" → "Close" (the "Import 0 items" button is disabled until a row is ticked) | closes the idle window | in the keyword field: searches once |
| Summarize (1-item collection) | 4 | "Re-summarize existing summaries" → "Save a summary note on each paper" → "Summarize" → "Close" | cancels a running job and stays open; closes when idle | on a box: Summarize; while a job runs: nothing; on Close: closes, starts nothing |
| Report | 3 | "Language" → "Generate report" → "Close" | cancels a running report and stays open; stops a running audio job and stays open; closes when idle | Generate when it is on; nothing when it is off or a report runs; on the list: the list's own |
| Cost dialog, ceiling moment | 2 | "Continue" → "Stop" | stops the run (`{"kind":"stop"}`) | stops the run: `defaultButton="cancel"` |
| Key-storage dialog | 2 | "Keep keys for this session" → "Continue without keys" | stores nothing (`"none"`) | stores nothing: `defaultButton="cancel"` |
| Preferences pane | 38 | Settings' own sidebar and search field first, then every control of the pane in document order, from "Remove all stored keys" to "Remove all Research Helper content…" | Zotero's Settings window | each control's own |
| Item pane section | header + 0 shown buttons | header named "Research Helper" | — | — |

**Fixed by this card:**

- **`summarize.js` and `reportWindow.js` had no keyboard contract of their own.** Each now has an
  `onKey` handler and a `takesOwnEnter` check, and the report window has `cancelAudio`.
  - The report window's Close button is unchanged: a click closes the window and lets the run
    go on (`plan/00` §6 item 324(a)).
  - DECIDED 2026-11-18 (coordinator, under item 313): Escape cancels first, as `docs/08` §9 and
    the search window already do, and Enter is the window's default action.
- **Two radio groups had no name:** `rh-search-duplicates` and `rh-cost-tier-choices`. Each now
  has `aria-labelledby` pointing to its visible prompt.
- **Every plugin dialog showed the platform's button labels.** Each window set
  `buttonlabelaccept` / `buttonlabelcancel` from Fluent after the `<dialog>` was built, and Gecko
  reads those attributes only while it builds the dialog.
  - Measured on 2026-11-18, without the fix. The cost dialog's accept button read "OK" where
    Fluent gives "Continue", and the key-storage dialog's read "OK" where Fluent gives "Keep keys
    for this session". With the fix's one line removed again (the mutation run), the search
    window's accept button read "OK" for "Import 0 items", and the report window's only button read
    "Cancel" for "Close".
  - The fix: `costConfirm.js`, `secretBackend.js`, `searchDialog.js` and `reportWindow.js` each
    label their buttons through a `labelButton` method. It sets the attribute and the rendered
    button's own label.
  - The spec's `assertButtonLabels` now checks every button of these four dialogs. Before the fix
    it failed on each one; after the fix it passes.

**Not exercised here:**

- the related and recommend modes of the search window, which start a run as they open;
- a summarize or report run's pre-flight moment of the cost dialog. *Updated 2026-11-18 (batch F,
  `plan/00` §6 item 402(f)):* the tier question is now exercised, on an audio run's pre-flight moment, built by
  `buildAudioDialogModel` with `askTierQuestion: true` and opened without starting a run. Tab
  reaches its controls with names, `rh-cost-tier-choices` is named by its prompt, and Escape
  cancels. That mutant (M10) is now killed (`plan/reports/P7-T06.md`). The ceiling moment shows
  no tier question by design (`docs/08` §6.4, `docs/07` §8.5);
- Zotero's own Settings window chrome.

## 2. Contrast, in Zotero's light and dark appearance

**How it was measured:**

- The spec switches Zotero's appearance with `browser.theme.toolbar-theme`: 1 is light and 0 is
  dark. This is the preference behind Settings → General → Appearance.
- For each text colour the plugin sets, it draws a probe with the plugin's own class, attribute
  selector or painter.
- It composes alpha over the nearest opaque background and computes the WCAG 2.1 ratio.
- The budget is 4.5:1 for body text (`NFR-13`).

Measured in run 1 of the three recorded full-suite runs of 2026-11-18 (`plan/reports/P7-batchE.md` §6).

| Appearance | Window | Text | Colour (composed alpha shown) | On | Ratio |
|---|---|---|---|---|---|
| light | Search & Import | body text | `rgba(0, 0, 0, 1.000)` | `rgb(255, 255, 255)` | 21.00:1 |
| light | Search & Import | body text on a chip or a hovered row | `rgba(0, 0, 0, 1.000)` | `rgb(242, 242, 242)` | 18.80:1 |
| light | Search & Import | table header text (--material-sidepane) | `rgba(0, 0, 0, 1.000)` | `rgb(242, 242, 242)` | 18.76:1 |
| light | Search & Import | hint (.rh-hint) | `rgba(0, 0, 0, 0.550)` | `rgb(255, 255, 255)` | 4.76:1 |
| light | Search & Import | hint (.rh-hint) on a hovered row | `rgba(0, 0, 0, 0.550)` | `rgb(242, 242, 242)` | 4.63:1 |
| light | Search & Import | relevance badge (.rh-relevance-badge) | `rgba(0, 0, 0, 0.550)` | `rgb(255, 255, 255)` | 4.76:1 |
| light | Search & Import | relevance badge (.rh-relevance-badge) on a hovered row | `rgba(0, 0, 0, 0.550)` | `rgb(242, 242, 242)` | 4.63:1 |
| light | Search & Import | source role (.rh-source-role) | `rgba(0, 0, 0, 0.550)` | `rgb(255, 255, 255)` | 4.76:1 |
| light | Search & Import | source role (.rh-source-role) on a hovered row | `rgba(0, 0, 0, 0.550)` | `rgb(242, 242, 242)` | 4.63:1 |
| light | Search & Import | inline warning (.rh-inline-warning) | `rgba(129, 26, 34, 0.933)` | `rgb(255, 255, 255)` | 8.61:1 |
| light | Search & Import | inline warning (.rh-inline-warning) on a hovered row | `rgba(129, 26, 34, 0.933)` | `rgb(242, 242, 242)` | 7.80:1 |
| light | Search & Import | in-library badge (.rh-existing-badge) | `rgba(129, 26, 34, 0.933)` | `rgb(255, 255, 255)` | 8.61:1 |
| light | Search & Import | in-library badge (.rh-existing-badge) on a hovered row | `rgba(129, 26, 34, 0.933)` | `rgb(242, 242, 242)` | 7.80:1 |
| light | Search & Import | possible-duplicate badge (.rh-duplicate-badge) | `rgba(150, 71, 45, 0.933)` | `rgb(255, 255, 255)` | 5.58:1 |
| light | Search & Import | possible-duplicate badge (.rh-duplicate-badge) on a hovered row | `rgba(150, 71, 45, 0.933)` | `rgb(242, 242, 242)` | 5.06:1 |
| light | Search & Import | linked badge (.rh-linked-badge) | `rgba(38, 67, 135, 0.933)` | `rgb(255, 255, 255)` | 7.82:1 |
| light | Search & Import | linked badge (.rh-linked-badge) on a hovered row | `rgba(38, 67, 135, 0.933)` | `rgb(242, 242, 242)` | 7.09:1 |
| light | Report | body text | `rgba(0, 0, 0, 1.000)` | `rgb(255, 255, 255)` | 21.00:1 |
| light | Report | pending stage row ([data-status="pending"]) | `rgba(0, 0, 0, 0.600)` | `rgb(255, 255, 255)` | 5.74:1 |
| light | Preferences | body text | `rgba(0, 0, 0, 0.850)` | `rgb(242, 242, 242)` | 13.81:1 |
| light | Preferences | key badge, warning (paintBadge) | `rgba(129, 26, 34, 0.933)` | `rgb(242, 242, 242)` | 7.78:1 |
| light | Preferences | key badge, valid (paintBadge) | `rgba(34, 113, 61, 0.933)` | `rgb(242, 242, 242)` | 4.73:1 |
| dark | Search & Import | body text | `rgba(251, 251, 254, 1.000)` | `rgb(30, 30, 30)` | 16.14:1 |
| dark | Search & Import | body text on a chip or a hovered row | `rgba(251, 251, 254, 1.000)` | `rgb(44, 44, 44)` | 13.61:1 |
| dark | Search & Import | hint (.rh-hint) | `rgba(255, 255, 255, 0.550)` | `rgb(30, 30, 30)` | 5.91:1 |
| dark | Search & Import | relevance badge (.rh-relevance-badge) | `rgba(255, 255, 255, 0.550)` | `rgb(30, 30, 30)` | 5.91:1 |
| dark | Search & Import | table header text (--material-sidepane) | `rgba(251, 251, 254, 1.000)` | `rgb(48, 48, 48)` | 12.78:1 |
| dark | Search & Import | hint (.rh-hint) on a hovered row | `rgba(255, 255, 255, 0.550)` | `rgb(44, 44, 44)` | 5.37:1 |
| dark | Search & Import | relevance badge (.rh-relevance-badge) on a hovered row | `rgba(255, 255, 255, 0.550)` | `rgb(44, 44, 44)` | 5.37:1 |
| dark | Search & Import | source role (.rh-source-role) | `rgba(255, 255, 255, 0.550)` | `rgb(30, 30, 30)` | 5.91:1 |
| dark | Search & Import | source role (.rh-source-role) on a hovered row | `rgba(255, 255, 255, 0.550)` | `rgb(44, 44, 44)` | 5.37:1 |
| dark | Search & Import | inline warning (.rh-inline-warning) | `rgba(235, 139, 147, 0.898)` | `rgb(30, 30, 30)` | 5.79:1 |
| dark | Search & Import | inline warning (.rh-inline-warning) on a hovered row | `rgba(235, 139, 147, 0.898)` | `rgb(44, 44, 44)` | 4.97:1 |
| dark | Search & Import | in-library badge (.rh-existing-badge) | `rgba(235, 139, 147, 0.898)` | `rgb(30, 30, 30)` | 5.79:1 |
| dark | Search & Import | in-library badge (.rh-existing-badge) on a hovered row | `rgba(235, 139, 147, 0.898)` | `rgb(44, 44, 44)` | 4.97:1 |
| dark | Search & Import | possible-duplicate badge (.rh-duplicate-badge) | `rgba(255, 183, 159, 0.870)` | `rgb(30, 30, 30)` | 7.84:1 |
| dark | Search & Import | possible-duplicate badge (.rh-duplicate-badge) on a hovered row | `rgba(255, 183, 159, 0.870)` | `rgb(44, 44, 44)` | 6.74:1 |
| dark | Search & Import | linked badge (.rh-linked-badge) | `rgba(145, 174, 240, 0.954)` | `rgb(30, 30, 30)` | 6.98:1 |
| dark | Search & Import | linked badge (.rh-linked-badge) on a hovered row | `rgba(145, 174, 240, 0.954)` | `rgb(44, 44, 44)` | 5.93:1 |
| dark | Report | body text | `rgba(0, 0, 0, 1.000)` | `rgb(255, 255, 255)` | 21.00:1 |
| dark | Report | pending stage row ([data-status="pending"]) | `rgba(0, 0, 0, 0.600)` | `rgb(255, 255, 255)` | 5.74:1 |
| dark | Preferences | body text | `rgba(255, 255, 255, 0.898)` | `rgb(48, 48, 48)` | 10.96:1 |
| dark | Preferences | key badge, warning (paintBadge) | `rgba(235, 139, 147, 0.898)` | `rgb(48, 48, 48)` | 4.69:1 |
| dark | Preferences | key badge, valid (paintBadge) | `rgba(149, 221, 174, 0.870)` | `rgb(48, 48, 48)` | 6.68:1 |

**Fixed by this card.**

- **Before the fix**, the plain Zotero accents fell below 4.5:1 when used as **text**. The run of
  2026-11-18 measured these ratios on the search window and the preferences pane:

  | Accent | Light | Dark |
  |---|---|---|
  | orange | 2.60:1 | — |
  | red | 4.24:1 on a hovered row; 4.23:1 on the preferences pane | 3.05:1; 2.47:1 on the pane |
  | blue | 4.42:1 | 3.78:1 |
  | green | 2.13:1 on the pane | — |

- **The fix:**
  - `addon/content/style/searchDialog.css` defines `--rh-text-red`, `--rh-text-orange` and
    `--rh-text-blue`;
  - `preferences.js`'s `paintBadge` does the same inline;
  - each mixes the accent 55% with `--fill-primary`, Zotero's body-text colour. That darkens it in
    light and lightens it in dark, and keeps the hue.
  - DECIDED 2026-11-18 (coordinator, under `plan/00` §6 item 313). 55% is the largest share at
    which every accent passed on every background measured.
- **The borders keep the plain accent.** A border is not text, and the words and the glyph carry
  the meaning.

**Observed, not a contrast failure.** In the dark appearance, the report window kept a light
background and black text:

- measured: the root's text `rgb(0, 0, 0)` on `rgb(242, 242, 242)`, while
  `prefers-color-scheme: dark` matched;
- its contrast stays 21:1, so this is not a contrast failure;
- it does not follow Zotero's dark appearance, which `docs/08` §9 asks for;
- the cause was not investigated in this batch. It is recorded as an open finding in
  `plan/reports/P7-T06.md`.

## 3. Colour is never the only carrier (`NFR-13`)

| Where | Meaning | Carried by, besides colour |
|---|---|---|
| Search row, already in the library | `.rh-existing-badge` | the ⚠ glyph (`::before`), the words of `research-helper-search-row-existing`, the badge's `aria-label`, a solid 3px row border |
| Search row, possible duplicate | `.rh-duplicate-badge` | the ≈ glyph, the words of `research-helper-search-row-duplicate`, a dashed row border |
| Search row, another version linked | `.rh-linked-badge` | the ⇄ glyph and its words |
| Search row, outside the recency window | greyed data cells | its "Outside the recency window" chip, in words |
| Source role (bioRxiv, medRxiv) | `.rh-source-role` | the ⊕ glyph and the role's words |
| Inline warning | `.rh-inline-warning` | the ⚠ glyph and the message's words |
| Report and audio stage rows | pending, active, done | `data-status`: the active row is bold with ⟳ and carries `aria-current="step"`; a done row has ✓; a pending row is dimmed and has neither |
| Preferences key badge | warning or valid | its words (`messageId`), and bold for a warning |

## 4. Live regions and completion

These elements announce, by role:

- **Search & Import:** the progress line, `role="status"` with `aria-live="polite"`; the source
  status list, `role="status"`; and three `role="alert"` messages.
- **Summarize:** `rh-summarize-stage` and `rh-summarize-outcome`, `role="status"`; the paused
  question, `role="alert"`.
- **Report:** `rh-report-stage`, `-outcome`, `-note`, `-delivery`, and the audio stage, outcome and
  saved lines, all `role="status"`; the question, stop reason and audio reason, `role="alert"`.
- **Cost dialog:** `rh-cost-notices`, `role="alert"`.
- **Preferences:** each key's test status, the backend badge, the usage lines, the privacy
  explanation and the data status, `role="status"`.

Whether NVDA announces them is §6's question. This file does not answer it.

## 5. Forced colours

`docs/08` §9 asks whether high-contrast mode reaches the plugin's windows. The spec set each of
two preferences alone and read `(forced-colors: active)` in the Search & Import window:

| Preference set | `(forced-colors: active)` | In-library badge text |
|---|---|---|
| `ui.useAccessibilityTheme` = 1 | false | unchanged, `rgba(235, 139, 147, 0.898)` on `rgb(30, 30, 30)` |
| `browser.display.document_color_use` = 2 | false | unchanged |

**What this shows.** Neither preference put this chrome window into forced colours in Zotero
10.0.3.

**What it does not show.** It does not show what Windows' own contrast themes do. That is a
system setting, and this card does not change system settings. The owner can check it during
`P7-T07`: §6 step 6.

## 6. NVDA procedure for the owner (`P7-T07`, `G-33`)

**Before.**

- Install NVDA from https://www.nvaccess.org/ if it is not already installed. That is the owner's
  download; this card downloads nothing.
- Use the test profile or a fresh profile, never the real library (`G-38`).
- Set Zotero to English for the first pass and to Korean for the second.

**Turn on NVDA's speech log.**

1. NVDA menu → **Tools → Speech Viewer**. It shows every utterance as text; keep it open.
2. NVDA menu → **Preferences → Settings → General → Logging level → Debug**, then **OK**.
3. After the run: NVDA menu → **Tools → View log**, then **Save as…**.
   - The log can contain whatever was on screen: titles of papers, collection names.
   - Do not attach it anywhere public. Copy only the lines this procedure asks about into
     `plan/reports/P7-T07.md`.

**Steps.** For each dialog below, open it, press Tab through it once, then do what the right-hand
column says. Record what NVDA says, from Speech Viewer, in three classes:

- **(a) the dialog title** as it opens;
- **(b) each control's label** as focus lands on it;
- **(c) job completion**, or the outcome line, when a job ends.

| # | Dialog | How to open it | Then |
|---|---|---|---|
| 1 | Search & Import | Tools → Research Helper → Search & Import… | type a word, press Enter (a search runs: free, no key), wait for the results; (c) is the result count line |
| 2 | Summarize | a collection's context menu → Summarize All Papers in Collection | press Escape. Starting a job needs a key and money (`G-45`); with a key and an approved spend, run one and record (c) |
| 3 | Report | a collection's context menu → Generate Research Trends Report… | Tab through; press Escape |
| 4 | Cost confirmation | appears before a paid run | Tab to both buttons; press Escape |
| 5 | Settings → Research Helper | Edit → Settings, then Research Helper in the sidebar | Tab through the first group (keys); press a **Test** button with no key entered and record the status line it reads out |
| 6 | Windows contrast theme (optional) | Windows Settings → Accessibility → Contrast themes | the owner turns one on, opens dialog 1, records whether its badges stay legible, and turns it off again |

**Pass** means:

- every dialog title is spoken;
- every control's spoken label matches its visible label;
- each job end is spoken without moving the focus.

Record any control that NVDA speaks as "button" or "edit" alone, with no label: it is a finding
for `P7-T07`.

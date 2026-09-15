# research_helper — strings injected into Zotero's own main window.
#
# docs/08 §10.1 owns the surface list; this is the mainWindow surface, which
# holds every string that appears inside a window Zotero owns rather than one
# the plugin creates — menus today, the Phase 3 run-time dialog fragments
# later.
#
# Every identifier is prefixed `research-helper-`. Fluent identifiers share one
# global namespace per DOM document, so an unprefixed ID silently shadows
# Zotero's own (docs/01 §9.3, §12 gotcha 16).
#
# The file sits directly under locale/en-US/ with a plugin-unique name, not in
# a research-helper/ subfolder: Zotero 10.0.1 drops subdirectories and shares
# one flat filename namespace across all plugins (docs/01 §9.1, P0-T32). The
# prefixes are written here by hand; zotero-plugin.config.ts adds none.
#
# locale/ko-KR/research-helper-mainWindow.ftl carries the same identifiers
# (P0-T24), except that `research-helper-menu-spike-create-item` is missing
# there on purpose: it is the key test/integration/l10n.spec.ts uses to prove
# a Korean UI falls back to this file's English rather than to the identifier
# (FR-55). This file is the fallback for every locale, so it must stay the
# complete one.

## Tools ▸ Research Helper (P0-T10)

research-helper-menu-root =
    .label = Research Helper

research-helper-menu-spike-create-item =
    .label = Create spike item (P0-T10)

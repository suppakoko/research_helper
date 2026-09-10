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
# The ko-KR bundle with the same identifiers arrives in P0-T24.

## Tools ▸ Research Helper (P0-T10)

research-helper-menu-root =
    .label = Research Helper

research-helper-menu-spike-create-item =
    .label = Create spike item (P0-T10)

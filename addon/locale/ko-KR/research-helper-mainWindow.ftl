# research_helper — Korean strings injected into Zotero's own main window.
#
# Same file name, same surface and same identifiers as
# locale/en-US/research-helper-mainWindow.ftl; read that file's header for the
# placement and prefix rules (docs/01 §9.1, §9.3). Korean text is taken from
# docs/08 §10.2 wherever that section provides it.
#
# DELIBERATELY INCOMPLETE (P0-T24, V-17). `research-helper-menu-spike-create-item`
# exists in en-US and is absent here on purpose, so that FR-55's English
# fallback for a missing key is observable. test/integration/l10n.spec.ts
# asserts both that it is absent from this bundle and that it still resolves
# to the English label under a Korean UI. Do not "fix" the gap without moving
# the fallback assertion to another key.

## Tools ▸ Research Helper (P0-T10)

research-helper-menu-root =
    .label = 리서치 헬퍼

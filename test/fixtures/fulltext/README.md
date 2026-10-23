# Full-text cleaning fixtures (`P3-T19`)

Every file here is **synthetic**: written on 2026-10-21 for `P3-T19`'s unit tests
(`test/unit/pipeline/clean.test.ts`, `test/unit/pipeline/jats.test.ts`). No sentence is
taken from a published paper, every number is invented, and no PDF is stored — the
`.txt` files imitate the *shape* of Zotero's extracted text as `docs/06` §3.3.5 and the
corrected D-06-4 record it (`\n` per printed line, a hyphenated break arriving as
`word\nword`, pages separated by exactly `\n\n\n\f`). Nothing here was fetched from the
network.

| File | What it imitates |
| --- | --- |
| `two-column-synthetic.txt` | four pages with a running head, a `Page N of 4` footer, a split word (`tar\ngeted`), a suspended hyphen (`N- and C-terminal`) and a reference list |
| `hyphenation-synthetic.txt` | `docs/06` §4.1 step 4's measured cases: suspended hyphens and `word\nword` splits |
| `line-numbers-synthetic.txt` | a two-page preprint with a line-number gutter |
| `korean-abstract-synthetic.txt` | a Korean abstract for `docs/06` §4.2 |
| `jats-synthetic.xml` | a Europe PMC `fullTextXML`-shaped JATS article exercising each row of `docs/06` §3.4's element table; text that must be dropped carries an upper-case `…-MARKER` |

The form feeds (`U+000C`) in the `.txt` files are real bytes; `.gitattributes` keeps
`test/fixtures/**` LF-only, and `.prettierignore` keeps Prettier off this directory.

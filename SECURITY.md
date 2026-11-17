# Security policy

Research Helper is a Zotero plugin. Like every Zotero plugin it runs with full access to Zotero
and to your computer, and it holds the API keys you give it. This file says how to report a
security problem, what to expect after you do, and what we will ask users to do if a release is
ever found to be compromised.

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x (not yet released) | Yes, once released |
| Anything before 1.0 | No: development builds only |

## Reporting a vulnerability

**Contact: _to be filled in by the maintainer before the first release._**

<!-- OWNER: put the reporting channel here (an address or GitHub's private vulnerability
reporting), then remove this comment. It is left blank on purpose: plan/00-task-index.md §6,
the P7-T16 owner question. -->

Please do not open a public issue for a security problem. Send:

- what you found, and the version of Research Helper and of Zotero;
- the steps that show it, if you have them;
- whether you think any API key or library content may have been exposed.

Do not send a real API key, or text from a paper you are not allowed to share. If a key is part
of the problem, rotate it first and describe it by its provider only.

## What to expect

_The maintainer confirms these times before the first release._

- We acknowledge a report within **7 days**.
- Within **30 days** we say what we will do: a fixed release, an advisory, or why we do not
  think it is a vulnerability.
- A fix ships through the normal update channel (`update.json` on the `release` branch), and
  the release notes say what was fixed and which versions were affected.

## What counts

In scope, for example:

- an API key reaching a Zotero preference, the plugin's database, a log, a note, an export, the
  clipboard or the network anywhere other than the provider it belongs to;
- paper content or library data sent somewhere the plugin's confirmation did not name;
- anything in the update channel (`update.json`, the release workflow, the XPI) that lets a
  build that is not ours install as ours.

Known and documented, so not a vulnerability on its own: software running under your own user
account, including any other Zotero plugin, can read the keys the plugin stores. Zotero does not
isolate plugins from each other. The preferences pane says so in full, and
[`docs/09-security-privacy-and-api-keys.md`](docs/09-security-privacy-and-api-keys.md) §1.8 is the
source of that text.

## If a release is compromised

If a release of Research Helper is ever found to be malicious or compromised, a compromised
release had access to every key you configured. So the first thing to do is:

1. **Rotate all configured API keys.** On each provider's own site, revoke the key you gave
   Research Helper and create a new one: OpenRouter, OpenAI, Google Gemini, Anthropic, NCBI and
   Semantic Scholar, whichever you set. Check each provider's usage page for spending you did
   not make.
2. **Update or remove the plugin.** Install the fixed version named in the advisory, or remove
   the plugin under **Tools → Plugins**. Removing the plugin does not replace step 1: a key
   that was read by a compromised build stays valid until you revoke it at the provider.
3. **Enter the new keys** only into the fixed version.

What the maintainers do:

1. Publish an advisory that names the affected versions and what the compromised build could
   reach.
2. Ship a fixed version through the same update channel, so Zotero offers it to every
   installed copy.
3. Tell users, in the advisory, the release notes and the Zotero Forums thread, to rotate every
   configured API key first.

This plan comes from `docs/09-security-privacy-and-api-keys.md` §6.4 ("Post-compromise response
plan").

## How keys are kept

API keys are encrypted with Zotero's `OSKeyStore` and kept in Zotero's login manager, never in
Zotero preferences. Where no working credential store exists, keys are held in memory for the
session only and must be entered again after a restart. A key is never shown again once stored:
the pane shows its first three and last four characters only. The details, and their limits,
are in [`docs/09-security-privacy-and-api-keys.md`](docs/09-security-privacy-and-api-keys.md) §1.

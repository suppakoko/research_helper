# 02 — Literature Database APIs

**Project:** `research_helper` (Zotero 10.x bootstrapped plugin)
**Scope:** implementation-ready reference for every bibliographic source the plugin queries.
**Architecture constraint:** **fully client-side.** There is no backend server. Every request in this
document is issued directly from the plugin process, from the end user's IP address, using the end
user's own API keys. This changes the calculus on rate limits, key custody, and etiquette — those
concerns are called out explicitly for every source.
**Verification date:** all live API probes in this document were executed on **2026-09-08**. Every
example response body is a real, trimmed response captured on that date unless explicitly marked
`> **Unverified:**`.
**Re-verification pass 2026-09-09:** NCBI (`esearch` incl. `reldate`/`datetype`, the `retstart`
ceiling, the `X-Ratelimit-*` headers, `efetch`, `elink`, the PMC ID Converter redirect), Europe PMC
(`resultType=core`, `SRC:PPR`, `cursorMark`, `pageSize` bounds, `/citations`, `fullTextXML`),
Crossref (all four pool/rate-header combinations), Semantic Scholar (Graph + Recommendations swagger
specs, `/paper/batch`, `embedding.specter_v2`), arXiv, bioRxiv/medRxiv, OpenAlex metering, and the
Zotero schema were all re-probed and confirmed. Sections corrected by that pass say so inline.

---

## Table of contents

1. [Source comparison summary](#1-source-comparison-summary)
2. [Client-side considerations that apply to every source](#2-client-side-considerations-that-apply-to-every-source)
3. [PubMed / NCBI E-utilities](#3-pubmed--ncbi-e-utilities)
4. [Europe PMC](#4-europe-pmc)
5. [Crossref REST API](#5-crossref-rest-api)
6. [Semantic Scholar Academic Graph API](#6-semantic-scholar-academic-graph-api)
7. [arXiv API](#7-arxiv-api)
8. [bioRxiv / medRxiv APIs](#8-biorxiv--medrxiv-apis)
9. [OpenAlex — evaluation and recommendation](#9-openalex--evaluation-and-recommendation)
10. [Cross-source normalization](#10-cross-source-normalization)
11. [Deduplication](#11-deduplication)
12. [Query translation](#12-query-translation)
13. [Sources](#sources)

---

## 1. Source comparison summary

Verified 2026-09-08. "Rate limit" is the *practical* client-side budget, not a theoretical maximum.

| Source | Cost | Key required? | Rate limit (verified) | Abstracts | Subject coverage | Citation data | Recommendations |
|---|---|---|---|---|---|---|---|
| **PubMed (E-utilities)** | Free | Optional (raises limit) | 3 req/s without key, 10 req/s with key. `X-RateLimit-Limit` header returned. | Yes, via `efetch&rettype=abstract&retmode=xml`. Not in `esummary`. | Biomedicine, life sciences | Inbound/outbound via `elink` (PMC-derived, partial) | Yes — `elink&cmd=neighbor_score` (pmra) |
| **Europe PMC** | Free | No | No key, no documented hard limit. Community guidance ~10 req/s per IP. Europe PMC's own error text cites a **1500-char** query limit, but it is **not enforced** at that length (§4.1). | **Yes, inline** via `resultType=core` → `abstractText` | Biomedicine + preprints + agri/patents | Yes — `/citations`, `/references` | No native recommender |
| **Crossref** | Free (Plus is paid) | No (Plus optional) | **Public pool: 1 req/s for list queries, 5 req/s for single-DOI.** **Polite pool (`mailto`): 3 req/s list, 10 req/s single-DOI**, concurrency 3. Verified via `x-rate-limit-limit`. | Partial — JATS XML in `abstract`, **~25–30 % coverage**, publisher-dependent | All disciplines (DOI registry) | `reference` list (opt-in by publisher), `is-referenced-by-count` | No |
| **Semantic Scholar** | Free | Strongly recommended | Unkeyed: shared 1000 req/s pool across *all* anonymous users → **429s are routine** (observed repeatedly). Keyed: **1 req/s** introductory. | Yes (`abstract`), plus `tldr` machine summary | All disciplines | Yes — `/citations`, `/references`, `influentialCitationCount` | **Yes — dedicated Recommendations API** |
| **arXiv** | Free | No | **1 request / 3 seconds, single connection.** Hard ToU requirement. | Yes (Atom `<summary>`) | Physics, CS, math, q-bio, stat, econ | No | No |
| **bioRxiv / medRxiv** | Free | No | Undocumented. Treat as ~1 req/s. | Yes (`abstract`, `preprint_abstract`) | Biology / health preprints only | No | No |
| **OpenAlex** | **Now metered** | **Effectively yes** (Feb 2026) | Keyless: **$0.10/day** budget (~1000 list credits). Free key: **$1.00/day**. Per-call: list `$0.0001`, search `$0.001`. | Yes, but as an **inverted index** (`abstract_inverted_index`) needing reconstruction | All disciplines, largest coverage | Yes — `referenced_works`, `cited_by_api_url` | `related_works` field |

**Headline recommendations:**

1. **Primary keyword-search stack:** Europe PMC (biomedical + preprints, no key, inline abstracts,
   generous limits) + arXiv (physics/CS) + Crossref (cross-disciplinary DOI backstop).
2. **Primary citation/recommendation stack:** Semantic Scholar, **with a user-supplied API key
   treated as near-mandatory** — see §6.4.
3. **PubMed** is used for MeSH terms, the ID cross-walk, and the `elink` related-articles feature —
   not as the bulk metadata source (its 2-request-per-record pattern is expensive).
4. **OpenAlex is out of v1** (decision D2, `00-overview.md` §3;
   `10-requirements-and-user-stories.md` §4 item 10). Its row stays in the table above and §9 keeps
   the full evaluation, because that is the evidence a v1.1 decision will need — see §9.3.

---

## 2. Client-side considerations that apply to every source

### 2.0 What "the last 3 years" means, and who owns it

Each source section below has a **"Date-range filtering — 'last 3 years'"** subsection. Those
subsections own the *mechanism* — which parameter each API accepts, at what granularity, with what
caveats — and nothing else. **This document does not own the window itself.**

- **The window is three calendar years: the current year and the two before it.** In 2026 that is
  `2024-01-01 … 2026-12-31`. It is **not** a rolling 36 months.
- **`08-ui-ux-spec.md` §4.2 owns the computation** (`fromYear = currentYear − 2`,
  `toYear = currentYear`, evaluated when the search window opens), and
  `10-requirements-and-user-stories.md` **FR-3** is the requirement, decided by the project owner on
  2026-09-09. The user-overridable span is the `searchYears` preference
  (`07-architecture-and-data-model.md` §8.5).

The date literals inside the per-source examples below are illustrations of each API's *syntax*, and
several of them are verbatim captures from the 2026-09-08 probe run, so some of them show a
36-month span (`2023-09-08 … 2026-09-08`). **Read those as "some window", not as the plugin's
default window.** The one place a rendered query is shown as the plugin would actually emit it —
§12.2's per-source translation example — uses the calendar-year window, and is the example to copy.

### 2.1 CORS is not your problem (but document it anyway)

Zotero 10.x is built on the Firefox platform. Bootstrapped plugin code runs in a **privileged
(system principal) context**, and requests issued through `Zotero.HTTP.request()` are **not subject
to the browser same-origin policy**. CORS headers are therefore irrelevant to the shipping plugin.

They *do* matter if any part of the UI is ever moved into an unprivileged `<iframe>` or a browser
extension, so the observed headers are recorded here (verified 2026-09-08 with `Origin:
https://example.org`):

| Source | `Access-Control-Allow-Origin` |
|---|---|
| NCBI E-utilities | `*` (also exposes `X-RateLimit-Limit`, `X-RateLimit-Remaining`) |
| Europe PMC | `*` (GET, POST, OPTIONS) |
| Crossref | `*` |
| Semantic Scholar | `*` |
| bioRxiv | `*` |
| OpenAlex | `*` |
| **arXiv (`export.arxiv.org`)** | **none — no CORS headers sent** |

> arXiv is the only source that would break in an unprivileged context. Keep arXiv calls in
> privileged code.

### 2.2 User-Agent and contact e-mail etiquette

Because every request originates from a *user's* IP rather than a shared server, a misbehaving
client gets **that user** blocked. Etiquette is not optional.

Set a single consistent User-Agent for all outbound requests:

```
research_helper/<version> (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)
```

`suppakoko@gmail.com` is the **maintainer** address, confirmed by the project owner on
2026-09-09. It is fixed at build time, ships inside the XPI, and goes out on every request to
every host. It is not a user setting and must never be replaced with a user's address.

Per-source contact requirements:

| Source | Mechanism | Enforced? |
|---|---|---|
| NCBI | `tool=` and `email=` query params | Not enforced, but NCBI blocks by IP and uses these to contact you first |
| Crossref | `mailto=` param **and** `User-Agent` header | Enforced — determines polite vs public pool (3× throughput) |
| OpenAlex | `api_key=` param (was `mailto=` polite pool pre-2026) | Enforced — budget is per key |
| Semantic Scholar | `x-api-key` header | Enforced |
| Europe PMC | `email=` param accepted | Not enforced |
| arXiv | User-Agent | Not enforced, but ToU-mandated 3 s delay is |

**Resolved: both addresses, in different slots.** An earlier draft of this document said to ship
*no* hard-coded developer address; `07-architecture-and-data-model.md` §7.3
and `09-security-privacy-and-api-keys.md` §5 said the opposite, quoting NCBI's registration
wording. Both concerns are real and they do not actually conflict, because the two identifiers go
in different places:

| Slot | Address | Why |
|---|---|---|
| `User-Agent` (every request, every host) | **Maintainer's**, fixed, shipped in the build | This identifies *the software*, which is what NCBI's registration requirement and arXiv's ToU are asking for. A maintainer address is also the only one that can receive an abuse report and act on it. |
| `mailto` / `email` **query parameter** | **User's**, from prefs, optional — but see the NCBI exception in the final assignment below | This identifies *this installation*, so per-user throttling is per user rather than pooled across everyone running the plugin. |

This is possible because §5.1 (verified 2026-09-09) establishes that Crossref promotes to the
polite pool on a contact address in **either** the `mailto` parameter **or** the `User-Agent` — so
a user who leaves the pref empty still gets the polite pool from the shipped `User-Agent`, and a
user who fills it in additionally gets their own throttle bucket. For NCBI, the `email` parameter
takes the maintainer address unconditionally, since NCBI wants a reachable developer contact rather
than a unique per-installation one — see the resolution below.

> **Settled by decision D10 (`00-overview.md` §3) on 2026-09-09:** the address that ships in the
> `User-Agent` is `suppakoko@gmail.com`. It is published in every outbound request and in the XPI,
> and the project owner has accepted making it public and monitoring it. The build substitutes it
> at package time and must fail rather than ship an unsubstituted placeholder.

> **The question that remained after that (NCBI only):** the user-address slot above is uncontroversial for
> Crossref's `mailto` and Europe PMC's `email`, but NCBI's own wording is narrower. NBK25497 states
> that `email` must be *"a complete and valid e-mail address of the software developer and not that
> of a third-party end user"* (quoted in §3.1 and in `09-security-privacy-and-api-keys.md` §5.1), and
> the same page makes `tool`/`email` a **registration** obligation.

**Resolved 2026-09-09 — option (a): NCBI is an exception.** NCBI always receives
`tool=research_helper&email=suppakoko@gmail.com`, the maintainer address, whatever the user has
configured. NBK25497's wording is explicit and there is no reading under which a per-installation
address satisfies it, so the plugin follows it literally rather than arguing with it. The user's
optional contact pref therefore applies **only to Crossref's `mailto` parameter**, where a
per-installation identity buys a separate throttle bucket and nothing in Crossref's terms forbids
it.

Final assignment:

| Host | `User-Agent` | Contact parameter |
|---|---|---|
| NCBI E-utilities | maintainer | `email=` **maintainer**, always (NBK25497) |
| Crossref | maintainer | `mailto=` **user's, if set**; maintainer otherwise |
| Europe PMC | maintainer | `email=` maintainer (no per-user benefit documented) |
| Semantic Scholar, arXiv, bioRxiv/medRxiv, OpenAlex | maintainer | none defined |

Consequence for the preferences pane: the field is a **general contact address**, not an
NCBI-specific one, and its help text must say what it is actually used for — see
`08-ui-ux-spec.md` §7.3. Naming it `ncbi.email` would be actively misleading, since NCBI is the
one host that ignores it.

### 2.3 API key custody

All keys are user-supplied and stored locally. Keys concerned in v1: NCBI (optional) and Semantic
Scholar (recommended). An OpenAlex key and a Crossref Plus token are **not** v1 concerns — OpenAlex
is out of v1 (§9.3) and Crossref Plus is rare — and neither has a `SecretId`. See doc 03 for the LLM
provider keys.

**Storage is not this document's decision.** Decision **D5** (`00-overview.md` §3) and
`09-security-privacy-and-api-keys.md` §1.7 own it: `Zotero.OSKeyStore.encrypt()` → `Services.logins`
as tier 1, session-only memory as tier 2, a passphrase-encrypted file in the profile directory as
tier 3, and **no plaintext-prefs tier** — plain `Zotero.Prefs` values are cleartext `user_pref(...)`
lines in `prefs.js` and never hold a credential. The `SecretId` union in doc 09 §1.7 currently covers
`source.ncbi` and `source.semanticscholar`; a Crossref Plus token or an OpenAlex key would each need
a new `SecretId` added there before either is implemented.

### 2.4 A shared rate-limit governor

Every adapter must go through one token-bucket scheduler keyed by host, because all of them share
one IP:

```ts
interface HostBudget {
  host: string;
  tokensPerInterval: number;
  intervalMs: number;
  maxConcurrent: number;
  minSpacingMs?: number;   // arXiv: 3000
}

// NOT AUTHORITATIVE. The shipped defaults live in `07-architecture-and-data-model.md`
// §7.3, per-host rate limiters (`src/core/rateLimit/hostLimiter.ts`). This document owns the
// *documented* limits of each API (above); doc 07 owns what we actually configure, which is
// deliberately below several of them for clock-skew headroom. Values here mirror doc 07 —
// if they ever diverge, doc 07 wins.
const BUDGETS: HostBudget[] = [
  // 2.5/s (not the documented 3/s) leaves headroom; 8/s with api_key, not the documented 10/s.
  { host: 'eutils.ncbi.nlm.nih.gov',  tokensPerInterval: 2.5, intervalMs: 1000, maxConcurrent: 3 },
  { host: 'www.ebi.ac.uk',            tokensPerInterval: 5,   intervalMs: 1000, maxConcurrent: 3 },
  // Header-driven: start at 2/interval and adapt to X-Rate-Limit-Limit / -Interval.
  // Polite pool (contact address in `mailto` OR the User-Agent) raises the ceiling; see §5.1.
  { host: 'api.crossref.org',         tokensPerInterval: 2,   intervalMs: 1000, maxConcurrent: 3 },
  // 0.9/s in BOTH modes — a key guarantees 1 RPS, while the anonymous pool is shared and
  // unpredictable, so there is no mode in which going faster is safe. See §6.4.
  { host: 'api.semanticscholar.org',  tokensPerInterval: 0.9, intervalMs: 1000, maxConcurrent: 1 },
  { host: 'export.arxiv.org',         tokensPerInterval: 1,   intervalMs: 3000, maxConcurrent: 1, minSpacingMs: 3000 },
  { host: 'api.biorxiv.org',          tokensPerInterval: 1,   intervalMs: 1000, maxConcurrent: 2 },
  // OpenAlex is OUT OF V1 (§9.3, decision D2) and therefore has NO row here and no row in
  // doc 07 §7.3's shipped policy table. If it is ever adopted, note that it is budget-bound
  // rather than rate-bound — the binding constraint is the daily USD meter (§9.1), not
  // requests per second — and add the row to doc 07 §7.3 first.
];
```

Universal retry policy: on **429** or **503**, honour `Retry-After` if present, else back off with
jitter up to a per-host attempt cap, then surface a user-visible error naming the source. Never retry
a **400** (it is a query bug) or a **404**. **The exact backoff shape is owned by
`07-architecture-and-data-model.md` §7.3** (decorrelated jitter, `sleep = min(cap, random(base,
prev*3))`, plus `limiter.penalize()` so a 429 parks every waiter on that host); do not implement a
second, differently-shaped backoff here.

---

## 3. PubMed / NCBI E-utilities

### 3.1 Base URL and auth

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
```

| Item | Value |
|---|---|
| API key required? | **No**, optional |
| Free tier | Fully free, no quota beyond rate |
| Without key | **3 requests/second** per IP |
| With key | **10 requests/second** per IP; higher by written request |
| Obtain key | NCBI account → Settings page → *API Key Management* (https://www.ncbi.nlm.nih.gov/account/) |
| Key param | `api_key=<key>` |
| Etiquette params | `tool=research_helper` and `email=<contact address>` on **every** request — which address goes in which slot is settled in §2.2 |

From the official usage guidelines: users should post "no more than three URL requests per second"
without a key and "up to 10 requests per second by default" with one; NCBI recommends running large
jobs "either weekends or between 9:00 PM and 5:00 AM Eastern time during weekdays," and warns that
"failure to comply with this policy may result in an IP address being blocked from accessing NCBI."
([E-utilities Usage Guidelines, NBK25497](https://www.ncbi.nlm.nih.gov/books/NBK25497/))

**Verified live:** NCBI now returns rate-limit headers, which the governor should read rather than
assume:

```
HTTP/1.1 200 OK
X-Ratelimit-Limit: 3
X-Ratelimit-Remaining: 2
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: X-RateLimit-Limit,X-RateLimit-Remaining
```

### 3.2 Endpoints used by research_helper

| Endpoint | Purpose in plugin |
|---|---|
| `esearch.fcgi` | keyword search → list of PMIDs (feature 1) |
| `efetch.fcgi` | full records incl. abstract + MeSH (features 1, 3) |
| `esummary.fcgi` | lightweight metadata when abstracts are not needed |
| `elink.fcgi` | related articles (feature 2) and citation links |
| PMC ID Converter | PMID ↔ PMCID ↔ DOI cross-walk (dedup) |

### 3.3 `esearch` — keyword search

Key parameters ([NBK25499](https://www.ncbi.nlm.nih.gov/books/NBK25499/)):

| Param | Notes |
|---|---|
| `db` | `pubmed` |
| `term` | Entrez query, URL-encoded |
| `retmax` | default 20, **max 10,000** |
| `retstart` | **max 9998** — see the hard ceiling below |
| `retmode` | `xml` (default) or `json` |
| `sort` | `relevance`, `pub_date`, `Author`, `JournalName` |
| `field` | restrict whole query to one field |
| `datetype` | `pdat` (publication), `edat` (Entrez/entry), `mdat` (modification) |
| `reldate` | integer *n* — last *n* days, combined with `datetype` |
| `mindate` / `maxdate` | `YYYY/MM/DD`, `YYYY/MM` or `YYYY`; **both required together** |
| `usehistory` | `y` → returns `webenv` + `querykey` for server-side result sets |

#### Date-range filtering — "last 3 years"

Three interchangeable mechanisms; pick per use case.

**(a) `reldate` — simplest, rolling window.** 3 years ≈ 1095 days.

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
  ?db=pubmed
  &term=CRISPR+base+editing
  &reldate=1095
  &datetype=edat
  &retmax=5
  &retmode=json
  &tool=research_helper&email=suppakoko@gmail.com
```

Real trimmed response (2026-09-08):

```json
{
  "header": { "type": "esearch", "version": "0.3" },
  "esearchresult": {
    "count": "8863",
    "retmax": "5",
    "retstart": "0",
    "idlist": ["42704951","42704632","42700952","42700916","42700448"],
    "translationset": [
      { "from": "CRISPR",
        "to": "\"clustered regularly interspaced short palindromic repeats\"[MeSH Terms] OR ... OR \"crispr\"[All Fields]" },
      { "from": "base editing",
        "to": "\"gene editing\"[MeSH Terms] OR (\"base\"[All Fields] AND \"editing\"[All Fields]) OR \"base editing\"[All Fields]" }
    ],
    "querytranslation": "(...) AND (...) AND 2023/09/09:2026/09/08[Date - Entry]"
  }
}
```

Note `querytranslation` — PubMed **automatically expands terms into MeSH**. This is free query
expansion the plugin gets for nothing, and it is worth surfacing to the user (§12.4).

**(b) `mindate`/`maxdate` — explicit window.**

```
&mindate=2023/09/08&maxdate=2026/09/08&datetype=pdat
```

**(c) In-term date filter — composes with Boolean logic.**

```
&term=CRISPR+AND+("2023/09/08"[PDAT] : "3000"[PDAT])
```

**Which `datetype`?** `edat` (Entrez date, when the record entered PubMed) is more stable and
better matches "recently published research" from a user's perspective, because `pdat` for
ahead-of-print records can be a future cover date. Observed live: a record dated `2026 Sep` was
returned by a search run in September 2026 for a *print* issue not yet distributed. **Default to
`edat`, expose `pdat` as an advanced option.**

#### The 9,999-record ceiling (hard constraint)

Verified live — `retstart=9999` returns an error inside an HTTP 200:

```json
{"header":{"type":"esearch","version":"0.3"},
 "esearchresult":{"ERROR":"Search Backend failed: Exception:\n'retstart' cannot be larger than 9998. For PubMed, ESearch can only retrieve the first 9,999 records matching the query. ..."}}
```

**Implication:** PubMed cannot be exhaustively paged past 9,999 hits. For broad queries, either
narrow by date slices (month-by-month) or accept the top-N. For research_helper's use case
(build a collection of the *N* most relevant recent papers, typically *N* ≤ 500) this is a
non-issue, but the adapter must detect `esearchresult.ERROR` and fail loudly rather than silently
returning zero results.

#### History server (`usehistory=y`)

For fetching more than a few hundred records, avoid long `id=` URL lists:

```
esearch.fcgi?db=pubmed&term=CRISPR&usehistory=y&retmax=0&mindate=2023/09/08&maxdate=2026/09/08&datetype=pdat
```

```json
{"esearchresult":{"count":"28198","retmax":"0","retstart":"0",
  "querykey":"1","webenv":"MCID_6a9fbe6de7945a8899092570","idlist":[], ...}}
```

Then page with `efetch.fcgi?db=pubmed&WebEnv=MCID_...&query_key=1&retstart=0&retmax=200&retmode=xml`.
WebEnv is transient — treat it as valid for a single session and re-issue `esearch` on failure.

### 3.4 `efetch` — records with abstracts and MeSH

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
  ?db=pubmed&id=37258680&rettype=abstract&retmode=xml
  &tool=research_helper&email=suppakoko@gmail.com
```

Batch up to **200 PMIDs per call** via comma-separated `id` (POST if the URL would exceed ~2000
chars). `retmode=xml` is the only mode that yields structured abstracts, MeSH headings, and the
full ID list — `retmode=text&rettype=abstract` gives a human-readable blob that is not worth
parsing, and `retmode=json` is **not supported for PubMed efetch**.

Real trimmed `PubmedArticle` XML (2026-09-08, PMID 37258680):

```xml
<PubmedArticleSet>
<PubmedArticle>
  <MedlineCitation Status="MEDLINE" Owner="NLM" IndexingMethod="Curated">
    <PMID Version="1">37258680</PMID>
    <DateRevised><Year>2026</Year><Month>04</Month><Day>23</Day></DateRevised>
    <Article PubModel="Print-Electronic">
      <Journal>
        <ISSN IssnType="Electronic">1476-4687</ISSN>
        <JournalIssue CitedMedium="Internet">
          <Volume>618</Volume><Issue>7965</Issue>
          <PubDate><Year>2023</Year><Month>Jun</Month></PubDate>
        </JournalIssue>
        <Title>Nature</Title>
        <ISOAbbreviation>Nature</ISOAbbreviation>
      </Journal>
      <ArticleTitle>Transfer learning enables predictions in network biology.</ArticleTitle>
      <Pagination><StartPage>616</StartPage><EndPage>624</EndPage><MedlinePgn>616-624</MedlinePgn></Pagination>
      <ELocationID EIdType="doi" ValidYN="Y">10.1038/s41586-023-06139-9</ELocationID>
      <Abstract>
        <AbstractText>Mapping gene networks requires large amounts of transcriptomic data ...
          Here, we developed a context-aware, attention-based deep learning model, Geneformer,
          pretrained on a large-scale corpus of about 30&#x2009;million single-cell transcriptomes ...</AbstractText>
        <CopyrightInformation>&#xa9; 2023. The Author(s), under exclusive licence to Springer Nature Limited.</CopyrightInformation>
      </Abstract>
      <AuthorList CompleteYN="Y">
        <Author ValidYN="Y">
          <LastName>Theodoris</LastName><ForeName>Christina V</ForeName><Initials>CV</Initials>
          <Identifier Source="ORCID">0000-0003-1658-1447</Identifier>
          <AffiliationInfo><Affiliation>Department of Data Science, Dana-Farber Cancer Institute, Boston, MA, USA.</Affiliation></AffiliationInfo>
        </Author>
        <!-- ... -->
      </AuthorList>
    </Article>
    <MeshHeadingList>
      <MeshHeading><DescriptorName UI="D006801" MajorTopicYN="N">Humans</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D001695" MajorTopicYN="Y">Biology</DescriptorName>
                   <QualifierName UI="Q000379" MajorTopicYN="N">methods</QualifierName></MeshHeading>
      <MeshHeading><DescriptorName UI="D000069550" MajorTopicYN="Y">Machine Learning</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D016571" MajorTopicYN="Y">Neural Networks, Computer</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D000092386" MajorTopicYN="N">Single-Cell Gene Expression Analysis</DescriptorName></MeshHeading>
      <MeshHeading><DescriptorName UI="D002843" MajorTopicYN="N">Chromatin</DescriptorName>
                   <QualifierName UI="Q000235" MajorTopicYN="N">genetics</QualifierName></MeshHeading>
    </MeshHeadingList>
  </MedlineCitation>
  <PubmedData>
    <History>
      <PubMedPubDate PubStatus="received"><Year>2022</Year><Month>3</Month><Day>29</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="accepted"><Year>2023</Year><Month>4</Month><Day>27</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="pubmed"><Year>2023</Year><Month>6</Month><Day>1</Day></PubMedPubDate>
      <PubMedPubDate PubStatus="entrez"><Year>2023</Year><Month>5</Month><Day>31</Day></PubMedPubDate>
    </History>
    <PublicationStatus>ppublish</PublicationStatus>
    <ArticleIdList>
      <ArticleId IdType="pubmed">37258680</ArticleId>
      <ArticleId IdType="pmc">PMC10949956</ArticleId>
      <ArticleId IdType="doi">10.1038/s41586-023-06139-9</ArticleId>
    </ArticleIdList>
  </PubmedData>
</PubmedArticle>
</PubmedArticleSet>
```

#### Parsing notes (these will bite you)

1. **Structured abstracts** have *multiple* `<AbstractText>` elements with `Label=` and
   `NlmCategory=` attributes (`BACKGROUND`, `METHODS`, `RESULTS`, `CONCLUSIONS`). Concatenate as
   `"{Label}: {text}"` joined by `\n\n`. A single unlabelled element is the common case.
2. **Inline markup** — `<sup>`, `<sub>`, `<i>`, `<b>` appear *inside* `AbstractText`. Use
   `textContent` on the element, not `innerHTML`, or strip tags. Note the example above contains
   `<sup>1,2</sup>` in the source.
3. **Numeric character references** — `&#x2009;` (thin space), `&#xa9;` (©) appear routinely. A
   real XML parser (`DOMParser`) handles these; regex parsing does not.
4. **Dates** — `<PubDate>` can be `<Year>/<Month>/<Day>`, `<Year>/<Month>`, `<Year>` alone, or
   `<MedlineDate>2023 Jun-Jul</MedlineDate>` (free text). Prefer
   `PubmedData/History/PubMedPubDate[@PubStatus='pubmed']` for a machine-parseable date, falling
   back to `ArticleDate` then `JournalIssue/PubDate`.
5. **Missing abstracts** — many records (editorials, some older papers) have no `<Abstract>` at all.
6. **MeSH** — `DescriptorName@UI` is the stable identifier; `@MajorTopicYN="Y"` marks the major
   topics, which are the ones worth using for collection profiling (§ doc 05).
7. **PMCID** lives in `PubmedData/ArticleIdList/ArticleId[@IdType='pmc']`.

### 3.5 `esummary` — lightweight alternative

`retmode=json` **is** supported here (unlike efetch). Useful when abstracts are not needed.

```
esummary.fcgi?db=pubmed&id=37258680&retmode=json&tool=research_helper&email=suppakoko@gmail.com
```

```json
{"header":{"type":"esummary","version":"0.3"},
 "result":{"uids":["37258680"],
  "37258680":{
    "uid":"37258680","pubdate":"2023 Jun","epubdate":"2023 May 31","source":"Nature",
    "authors":[{"name":"Theodoris CV","authtype":"Author"}, {"name":"Xiao L","authtype":"Author"}],
    "lastauthor":"Ellinor PT",
    "title":"Transfer learning enables predictions in network biology.",
    "volume":"618","issue":"7965","pages":"616-624","lang":["eng"],
    "nlmuniqueid":"0410462","issn":"0028-0836","essn":"1476-4687",
    "pubtype":["Journal Article","Research Support, N.I.H., Extramural"],
    "recordstatus":"PubMed - indexed for MEDLINE",
    "articleids":[
      {"idtype":"pubmed","value":"37258680"},
      {"idtype":"pmc","value":"PMC10949956"},
      {"idtype":"doi","value":"10.1038/s41586-023-06139-9"}]
  }}}
```

**No abstract, no MeSH.** For research_helper, `efetch` is almost always the right call — the whole
point is to have abstracts for the LLM. Use `esummary` only for cheap existence/metadata checks.

### 3.6 `elink` — related articles and citation links

Covered in depth in doc 05. Summary here:

| `linkname` | Meaning |
|---|---|
| `pubmed_pubmed` | pmra "Related Articles" (similarity-ranked) |
| `pubmed_pubmed_refs` | references cited by the article (PMC-derived) |
| `pubmed_pubmed_citedin` | articles citing it (PMC-derived, undercounts) |
| `pubmed_pmc` | PMC full-text link |

```
elink.fcgi?dbfrom=pubmed&db=pubmed&id=37258680&cmd=neighbor_score&linkname=pubmed_pubmed&retmode=json
```

```json
{"header":{"type":"elink","version":"0.3"},
 "linksets":[{"dbfrom":"pubmed","ids":["37258680"],
  "linksetdbs":[{"dbto":"pubmed","linkname":"pubmed_pubmed",
   "links":[{"id":"42026145","score":28347383},
            {"id":"39636237","score":24718838},
            {"id":"41896605","score":22621790},
            {"id":"40106407","score":22588756},
            {"id":"40117988","score":21881630}]}]}]}
```

`cmd=neighbor_score` returns a raw pmra score. **Scores are only comparable within one linkset** —
they are unnormalised and the first entry is usually the seed article itself in `cmd=neighbor`
output. Normalise by dividing by the maximum score in the set before mixing with other signals.

`elink` returns a **long list** (hundreds). Slice client-side.

### 3.7 PMC ID Converter — **endpoint has moved**

> **Verified 2026-09-08:** the classic `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/` URL now
> issues a **301 redirect**. Follow redirects, or better, call the new URL directly.

**New base URL:**

```
https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/
```

**Behaviour change that will break naive ports:** the new endpoint no longer auto-detects mixed ID
types. Passing a DOI without `idtype` fails:

```json
{"status":"error","http_status":"400","http_status_reason":"Bad Request",
 "errors":[{"message":"All values of query param `ids` must be PubMed IDs (Positive Integers).",
            "code":"invalid_pmids"}]}
```

You must **group IDs by type** and set `idtype` per call. Verified working:

```
# PMIDs (idtype defaults to pmid)
.../articles/?ids=37258680,29355051&format=json&tool=research_helper&email=suppakoko@gmail.com
```
```json
{"status":"ok","records":[
  {"doi":"10.1038/s41586-023-06139-9","pmcid":"PMC10949956","pmid":37258680,"requested-id":"37258680"},
  {"doi":"10.1177/1534735417753544","pmcid":"PMC6142073","pmid":29355051,"requested-id":"29355051"}]}
```
```
# DOIs
.../articles/?ids=10.1038/s41586-023-06139-9&idtype=doi&format=json&...
# PMCIDs
.../articles/?ids=PMC7605294&idtype=pmcid&format=json&...
```
```json
{"status":"ok","records":[{"doi":"10.4103/tcmj.tcmj_71_20","pmcid":"PMC7605294","pmid":33163378,"requested-id":"PMC7605294"}]}
```

Accepted `idtype` values: `pmid`, `pmcid`, `doi`, `mid`. Batch limit is **200 IDs per request**
(documented historically; re-confirm before relying on >100).
Optional: `versions=yes`, `showaiid=yes`.

### 3.8 Errors and licensing

| Condition | Behaviour |
|---|---|
| Rate exceeded | HTTP **429** with a short HTML/XML body |
| Bad query | HTTP **200** with `esearchresult.ERROR` — **must check the body** |
| Unknown PMID in efetch | Empty `<PubmedArticleSet/>`, HTTP 200 |
| Server overload | HTTP **500** / **502**; back off |

**Licensing:** PubMed *records* (bibliographic metadata) are in the public domain and freely
redistributable. **Abstracts are not** — they are typically under publisher copyright, as visible in
`<CopyrightInformation>`. NLM's position is that abstracts may be retrieved and displayed, but bulk
redistribution may require publisher permission. For research_helper this is fine: abstracts land
in the user's own local Zotero library and are sent to the user's own LLM provider. **Do not** build
any feature that republishes abstracts publicly.

---

## 4. Europe PMC

### 4.1 Base URL and auth

```
https://www.ebi.ac.uk/europepmc/webservices/rest/
```

| Item | Value |
|---|---|
| API key | **None required, none available** |
| Cost | Free |
| Rate limit | Not formally documented. Community guidance and EBI support responses cite roughly **10 req/s per IP**; there is no published hard cap. |
| Contact param | `email=` accepted (courtesy) |
| Query length | 1500 characters is the figure in Europe PMC's own error text, but it is **not enforced** — see below |
| Page size | **1–1000** (verified: `pageSize=1001` → error) |

> **Unverified:** the 10 req/s figure comes from EBI support threads on the `epmc-webservices`
> Google Group, not from a formal SLA page. The shipped budget is half of it — **5 req/s**, three
> concurrent — which is `07-architecture-and-data-model.md` §7.3's row for `www.ebi.ac.uk` and what
> §2.4's `BUDGETS` above mirrors; doc 07 owns that number and it is not raised without confirming
> the limit with the Europe PMC team. Honour any 429 the service returns regardless.

**On the 1500-character query limit — corrected.** The number appears only in the service's own
error message (`"…provide a search criteria which is less than 1500 characters"`, returned for an
*empty* `query`, §4.9). Live probing found **no enforcement at 1500**: GET requests with
`query=` of 1500, 2000, 3000 and 5000 characters all returned HTTP 200 with the full query echoed
in `request.queryString`. The real ceiling observed is the **URI length** — a ~12,000-character
query returned nginx's `414 Request-URI Too Large`. Treat 1500 as a conservative design budget and
switch to `searchPOST` above it (§4.2), but do not code an assertion that assumes a 1500 cutoff.

Europe PMC is the **single best general-purpose source for this project**: no key, inline
abstracts, preprints and published literature in one index, citation and reference endpoints, a real
query language, and cursor pagination. Make it the default.

### 4.2 Endpoints

| Endpoint | Template |
|---|---|
| Search | `GET /search?query=…&resultType=…&format=json&pageSize=…&cursorMark=…` |
| Search (POST) | `POST /searchPOST` with `application/x-www-form-urlencoded` body — **use this when the query exceeds URL limits** |
| Full text | `GET /{PMCID}/fullTextXML` |
| Citations | `GET /{source}/{id}/citations?page=…&pageSize=…&format=json` |
| References | `GET /{source}/{id}/references?page=…&pageSize=…&format=json` |
| Database links | `GET /{source}/{id}/databaseLinks?format=json` |
| Text-mined terms | `GET /{source}/{id}/textMinedTerms/{type}` |
| Supplementary files | `GET /{source}/{id}/supplementaryFiles` |

`{source}` is a two/three-letter corpus code: `MED` (PubMed/MEDLINE), `PMC`, **`PPR` (preprints)**,
`AGR`, `CBA`, `PAT`, `ETH`, `HIR`, `CTX`.

### 4.3 Query syntax

Field-prefixed, Lucene-ish, with `AND` / `OR` / `NOT` and parentheses.

| Field | Meaning | Example |
|---|---|---|
| `TITLE` | title | `TITLE:"base editing"` |
| `ABSTRACT` | abstract | `ABSTRACT:CRISPR` |
| `TITLE_ABS` | title or abstract | `TITLE_ABS:"prime editing"` |
| `AUTH` | author | `AUTH:"Doudna J"` |
| `JOURNAL` | journal | `JOURNAL:"Nature"` |
| `PUB_YEAR` | publication year | `PUB_YEAR:[2023 TO 2026]` |
| `FIRST_PDATE` | first publication date | `FIRST_PDATE:[2023-09-08 TO 2026-09-08]` |
| `SRC` | corpus | `SRC:MED`, `SRC:PPR` |
| `DOI` | DOI | `DOI:"10.1038/s41586-023-06139-9"` |
| `EXT_ID` | PMID | `EXT_ID:37258680` |
| `OPEN_ACCESS` | `y`/`n` | `OPEN_ACCESS:y` |
| `HAS_ABSTRACT` | `y`/`n` | `HAS_ABSTRACT:y` |
| `PUB_TYPE` | publication type | `PUB_TYPE:"review"` |
| `MESH_TERM` | MeSH descriptor | `MESH_TERM:"Gene Editing"` |
| `IN_EPMC` / `HAS_FT` | full text availability | `IN_EPMC:y` |

Sort: `&sort=P_PDATE_D desc` or query-embedded `sort_date:y` / `sort_cited:y`.
Synonym expansion: `&synonym=true` (off by default; expands via MeSH/UniProt vocabularies).

#### Date-range filtering — "last 3 years"

Two options, and **they are not equivalent**:

```
# Year granularity — whole calendar years
(CRISPR) AND (PUB_YEAR:[2024 TO 2026])

# Day granularity — an arbitrary window, including a rolling one
(CRISPR) AND (FIRST_PDATE:[2023-09-08 TO 2026-09-08])
```

Both are available; which one the plugin sends follows from the window it is asked for, and **that
window is `08-ui-ux-spec.md` §4.2's, not this document's.** §4.2 and `10-requirements-and-user-stories.md`
FR-3 settle it as **three calendar years** — the current year and the two before it — so the plugin's
default run uses the whole-year form, `PUB_YEAR:[2024 TO 2026]` in 2026, or equivalently
`FIRST_PDATE:[2024-01-01 TO 2026-12-31]`. Use `FIRST_PDATE` when the user has set an explicit
custom range with day precision, which the "Custom…" option in §4.2 allows. (An earlier draft of
this note recommended `FIRST_PDATE` as *the* mechanism for the "last 3 years" feature on the
grounds that it gives "a true rolling 3-year window"; a rolling window is not what the feature is.)

### 4.4 `search` — real request and response

```
https://www.ebi.ac.uk/europepmc/webservices/rest/search
  ?query=(CRISPR)%20AND%20(PUB_YEAR%3A%5B2023%20TO%202026%5D)
  &resultType=core
  &format=json
  &pageSize=1
```

> **Measured 2026-09-15 (`P0-T21`), query `CRISPR base editing`, top 100:** 93 % carried `abstractText` — MED 86/89, PPR 7/7, but **PMC 0/4** despite `resultType=core`. **33 of 93 abstracts contained inline HTML** (`<i>Wx</i>`), so Europe PMC abstracts need tag stripping too, not only Crossref's JATS. One HTTP **504** on a 25-DOI OR query was seen (not reproduced); §4.9 documents errors only as `errCode` inside HTTP 200, so the adapter must also handle a gateway 5xx and split failing DOI batches.

**`resultType` matters enormously:**

| Value | Contains |
|---|---|
| `idlist` | IDs + source only — cheapest, use for dedup/count |
| `lite` | core bibliographic metadata, **no abstract** (default) |
| `core` | **everything including `abstractText`**, full author list with affiliations, keywords, MeSH, full-text URLs, grants |

Real trimmed `core` response (2026-09-08):

```json
{
  "version": "6.9",
  "hitCount": 114098,
  "nextCursorMark": "AoIIQEOWhig1NjM2MzAxMQ==",
  "nextPageUrl": "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=...&cursorMark=AoIIQEOWhig1NjM2MzAxMQ==&resultType=core&pageSize=1&format=json",
  "request": { "queryString": "(CRISPR) AND (PUB_YEAR:[2023 TO 2026])",
               "resultType": "core", "cursorMark": "*", "pageSize": 1, "synonym": false },
  "resultList": { "result": [{
    "id": "42700480",
    "source": "MED",
    "pmid": "42700480",
    "doi": "10.1016/j.bios.2026.119197",
    "title": "Advances in cascaded CRISPR for preamplification-free nucleic acid assays.",
    "authorString": "He R, Miao L, Deng R, Xia X.",
    "authorList": { "author": [
      { "fullName": "He R", "firstName": "Ruonan", "lastName": "He", "initials": "R",
        "authorAffiliationDetailsList": { "authorAffiliation": [
          { "affiliation": "College of Ecology and Environment, Chengdu University of Technology, Chengdu, 610059, China." }]}}
    ]},
    "journalInfo": {
      "volume": "314", "dateOfPublication": "2026 Sep",
      "monthOfPublication": 9, "yearOfPublication": 2026,
      "printPublicationDate": "2026-09-01",
      "journal": { "title": "Biosensors & bioelectronics",
                   "medlineAbbreviation": "Biosens Bioelectron",
                   "essn": "1873-4235", "issn": "0956-5663",
                   "isoabbreviation": "Biosens Bioelectron", "nlmid": "9001289" }},
    "pubYear": "2026",
    "pageInfo": "119197",
    "abstractText": "The development of rapid, sensitive, and specific nucleic acid assays is pivotal for advancing molecular detection in clinical diagnosis, food safety, and environmental monitoring. ...",
    "publicationStatus": "aheadofprint",
    "language": "eng",
    "pubTypeList": { "pubType": ["Review", "Journal Article"] },
    "keywordList": { "keyword": ["Nucleic acid","Rapid detection","Biosensing","Preamplification-free","Cascaded Crispr"] },
    "fullTextUrlList": { "fullTextUrl": [
      { "availability": "Subscription required", "availabilityCode": "S",
        "documentStyle": "doi", "site": "DOI", "url": "https://doi.org/10.1016/j.bios.2026.119197" }]}
  }]}
}
```

**Abstract coverage is excellent** — Europe PMC returns `abstractText` inline for the overwhelming
majority of MED-source records, which makes it a single-round-trip source, unlike PubMed's
search-then-fetch pattern.

### 4.5 Preprints via `SRC:PPR`

Europe PMC indexes bioRxiv/medRxiv/Research Square/SSRN preprints. This is the **recommended route
to preprints** (see §8.4).

```
/search?query=(SRC%3APPR)%20AND%20(base%20editing)%20AND%20(FIRST_PDATE%3A%5B2023-09-01%20TO%202026-09-08%5D)&resultType=lite&format=json&pageSize=2
```

```json
{"version":"6.9","hitCount":2163,
 "nextCursorMark":"AoIIQHqxVSg1NjE1NTMzOA==",
 "resultList":{"result":[
  {"id":"PPR1302423","source":"PPR",
   "doi":"10.64898/2026.08.20.745440",
   "title":"Multi-color droplet digital PCR assay enables allele-specific quantification of heterogeneous genome editing outcomes",
   "authorString":"Yasuda Y, Miyaoka Y.",
   "pubYear":"2026","pubType":"preprint",
   "bookOrReportDetails":{"publisher":"bioRxiv","yearOfPublication":2026},
   "isOpenAccess":"N","inEPMC":"N","hasPDF":"N",
   "citedByCount":0,"hasReferences":"Y","hasTextMinedTerms":"Y",
   "firstIndexDate":"2026-08-22","firstPublicationDate":"2026-08-20"},
  {"id":"PPR1300522","source":"PPR",
   "doi":"10.64898/2026.08.17.745336",
   "title":"Virus-like particle-delivered base editor collection to expand the genome engineering toolbox",
   "authorString":"Salaudeen AL, Shyiak T, de Boer CG.",
   "pubYear":"2026","pubType":"preprint",
   "bookOrReportDetails":{"publisher":"bioRxiv","yearOfPublication":2026},
   "firstPublicationDate":"2026-08-18"}]}}
```

Note `bookOrReportDetails.publisher` carries the preprint server name — map it to the Zotero
`repository` field. **Note the `10.64898/` DOI prefix** — see §11.2.

### 4.6 Pagination: `cursorMark`

```
&cursorMark=*              # first page
&cursorMark=<nextCursorMark from previous response>
```

Rules:
- Do **not** mix `cursorMark` with `page=`.
- The response gives `nextCursorMark` and a ready-made `nextPageUrl` — using `nextPageUrl` verbatim
  is the least error-prone approach, but **URL-decode it first**: as seen above, Europe PMC returns
  it with *unencoded spaces* in the query string.
- Termination: stop when `nextCursorMark` equals the cursor you sent, or when
  `resultList.result` is empty.
- `page=` (1-based) works up to a depth limit and is fine for the first few pages; `cursorMark` is
  required for deep paging.

### 4.7 `citations` and `references`

```
GET /MED/37258680/citations?page=1&pageSize=2&format=json
```
```json
{"version":"6.9","hitCount":857,
 "request":{"id":"37258680","source":"MED","offSet":0,"pageSize":2},
 "citationList":{"citation":[
  {"id":"42696754","source":"MED","citationType":"journal article",
   "title":"Gene-Chronos: parameter-efficient developmental time inference using a pretrained single-cell foundation model.",
   "authorString":"Liu Y, Gao H, Tian T.","journalAbbreviation":"Brief Bioinform",
   "pubYear":2026,"volume":"27","issue":"5","pageInfo":"bbag469","citedByCount":0},
  {"id":"41888299","source":"MED","citationType":"journal article",
   "title":"Towards predictive virtual embryos with genomics and AI.",
   "authorString":"Cao N, Lu Y, Qiu X.","journalAbbreviation":"Nat Methods",
   "pubYear":2026,"volume":"23","issue":"9","pageInfo":"1666-1670","citedByCount":1}]}}
```

`references` has the same shape under `referenceList.reference`.

> **Note:** during testing (2026-09-08, re-confirmed 2026-09-09) the `/references` endpoint was down
> for maintenance while `/citations` worked normally. Re-probed exactly, it answers
> **HTTP 503** with `Content-Type: text/plain` and the body
> `"This API is temporarily unavailable due to maintenance."` — for both `MED` and `PMC` sources.
> Two lessons, both real and observed: **(a) individual Europe PMC endpoints go down
> independently**, so `/references` failing must not disable the `/citations` path; and **(b) a
> Europe PMC error body is not always JSON**, so the adapter must check `Content-Type` / attempt the
> JSON parse defensively rather than assuming every response is a JSON envelope.

`databaseLinks` returned an empty result for the test article; it links to molecular databases
(UniProt, PDB, ENA) rather than to other papers, so it is **not useful for related-work discovery**
and can be skipped.

### 4.8 `fullTextXML` — open-access full text

```
GET /PMC6142073/fullTextXML          →  HTTP 200, 75,657 bytes of JATS XML
GET /PMC7605294/fullTextXML          →  HTTP 200, 43,659 bytes of JATS XML
GET /PMC10949956/fullTextXML         →  HTTP 404, Content-Length: 0 (indexed, but not OA in EPMC)
GET /PMC99999999/fullTextXML         →  HTTP 404, Content-Length: 0 (unknown ID)
```

Real head of a successful response:

```xml
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD with MathML3 v1.4 20241031//EN" "JATS-archivearticle1-4-mathml3.dtd">
<article article-type="research-article" xml:lang="en" dtd-version="1.4">
  <front><journal-meta>
    <journal-id journal-id-type="nlm-ta">Integr Cancer Ther</journal-id>
    <journal-id journal-id-type="iso-abbrev">Integr Cancer Ther</journal-id>
    ...
```

**Two outcomes to handle:** 200-with-content (OA full text available) and **404 with an empty
body**. The 404 is returned identically for "the article exists in Europe PMC but its full text is
not open access here" (`PMC10949956`) and for "no such ID" (`PMC99999999`) — so a 404 tells you
nothing about whether the ID is valid, and must not be treated as an ID error. Gate calls on
`inEPMC:"Y"` / `isOpenAccess:"Y"` from the search result to avoid wasting requests.

Full text is only worth fetching for feature 3 (summarization) when the abstract is judged
insufficient — it is 50–150× larger than an abstract and will blow LLM context budgets. **Default
to abstract-only summarization**; make full-text an explicit per-collection opt-in.

### 4.9 Errors and licensing

Europe PMC returns application errors **inside HTTP 200 bodies**:

Two real examples (each is a separate response body, not one document):

```json
{"errCode":404,"errMsg":"No search criteria provided. Please provide a search criteria which is less than 1500 characters."}
```

```json
{"errCode":404,"errMsg":"Invalid page size provided. Valid size is between 1 and 1000"}
```

**Always check for an `errCode` key before reading `resultList`.**

**Licensing:** Europe PMC metadata is broadly reusable; the OA subset full text carries per-article
licences (CC-BY etc.) exposed in the JATS `<permissions>` block. Abstracts of non-OA articles remain
publisher-copyrighted. Same guidance as PubMed: local use and user-directed LLM processing is fine;
public republication is not.

---

## 5. Crossref REST API

### 5.1 Base URL, pools, and auth

```
https://api.crossref.org
```

| Item | Value |
|---|---|
| API key | **Not required** |
| Cost | Free; **Metadata Plus** is a paid subscription |
| Plus auth header | `Crossref-Plus-API-Token: Bearer <token>` |

**Rate limits changed on 1 December 2025.** Verified live 2026-09-08 via response headers:

| Pool | List queries (`/works?query…`) | Single DOI (`/works/{doi}`) | Concurrency | `x-api-pool` |
|---|---|---|---|---|
| **Public** (no `mailto`) | **1 req/s** | 5 req/s | **1** | `public-array` |
| **Polite** (`mailto` + UA) | **3 req/s** | 10 req/s | **3** | `polite-array` |
| **Plus** | higher | higher | higher | `plus` |

Observed headers, polite pool:
```
x-rate-limit-limit: 3
x-rate-limit-interval: 1s
x-concurrency-limit: 3
x-api-pool: polite-array
access-control-allow-origin: *
```
Observed headers, public pool:
```
x-rate-limit-limit: 1
x-rate-limit-interval: 1s
x-concurrency-limit: 1
x-api-pool: public-array
```

**This is a 3× throughput difference for one contact address.** Joining the polite pool is
mandatory for this project. **Either** mechanism is sufficient on its own — corrected and verified
2026-09-09 by isolating each:

| Request | `x-api-pool` | `x-rate-limit-limit` |
|---|---|---|
| `&mailto=…`, generic `User-Agent: curl/8.0` | `polite-array` | 3 |
| No `mailto`, `User-Agent: research_helper/0.1 (https://example.org; mailto:…)` | `polite-array` | 3 |
| No `mailto`, `User-Agent: research_helper/0.1` (no contact address) | `public-array` | 1 |

So it is the **presence of a contact address**, in either place, that promotes the request — not the
pairing. Send both anyway:

1. `&mailto=user@example.org` query parameter — the **user's** address, per the two-slot scheme in
   §2.2 — **and**
2. a `User-Agent` header naming the tool and carrying the **maintainer's** address (§2.2):
   `research_helper/0.1 (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)`

Belt and braces costs nothing, and a request that reaches Crossref through a proxy that rewrites
`User-Agent` still lands in the polite pool.

Always read `x-rate-limit-limit` / `x-rate-limit-interval` from the response and reconfigure the
governor — Crossref changes these and advertises the current values on every call.

### 5.2 `/works` query parameters

| Param | Notes |
|---|---|
| `query` | free text across all fields |
| `query.bibliographic` | **the one to use for keyword search** — titles, authors, ISSNs, years |
| `query.title` | title only |
| `query.author`, `query.container-title`, `query.affiliation`, `query.editor`, … | field-specific |
| `filter` | comma-separated `name:value` pairs, AND-ed |
| `select` | comma-separated field whitelist — **use it, responses are otherwise enormous** |
| `rows` | default 20, **max 1000** |
| `offset` | shallow paging only, capped at 10,000 |
| `cursor` | `*` for first page, then `next-cursor` — required for deep paging |
| `sort` / `order` | `relevance`, `issued`, `published`, `created`, `is-referenced-by-count`, `score`; `asc`/`desc` |
| `sample` | N random items (ignores `offset`) |
| `mailto` | polite pool |

Relevant `filter` names:

| Filter | Meaning |
|---|---|
| `from-pub-date` / `until-pub-date` | earliest published date (print or online) — **use for "last 3 years"** |
| `from-online-pub-date` / `until-online-pub-date` | online publication date |
| `from-print-pub-date` / `until-print-pub-date` | print publication date |
| `from-created-date` / `until-created-date` | when the DOI record was created at Crossref |
| `from-index-date` / `until-index-date` | when the record was last indexed |
| `type` | `journal-article`, `posted-content`, `proceedings-article`, `book-chapter`, … |
| `has-abstract` | `true`/`false` |
| `has-full-text`, `has-references`, `has-orcid`, `has-license` | booleans |
| `issn`, `container-title`, `publisher-name`, `funder` | scoping |

#### Date-range filtering — "last 3 years"

```
&filter=from-pub-date:2023-09-08,until-pub-date:2026-09-08,type:journal-article
```

Dates accept `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Multiple filters in one `filter` param are
comma-separated and combined with **AND**; repeating the *same* filter name ORs it.

**Caveat:** Crossref `issued` dates are supplied by publishers and are frequently the *cover* date,
which can be months ahead of actual availability, and occasionally wrong by years. For a strict
recency guarantee, add `from-created-date` as a secondary filter:

```
&filter=from-pub-date:2023-09-08,from-created-date:2023-06-01
```

### 5.3 Real request and response

```
https://api.crossref.org/works
  ?query.bibliographic=CRISPR+base+editing
  &filter=from-pub-date:2023-01-01,type:journal-article
  &rows=1
  &select=DOI,title,abstract,author,issued,container-title,type,is-referenced-by-count,ISSN,URL
  &mailto=user@example.org
```
with `User-Agent: research_helper/0.1 (mailto:suppakoko@gmail.com)` (the `User-Agent` slot carries
the maintainer address; the `mailto` parameter above carries the user's — §2.2)

```json
{"status":"ok","message-type":"work-list","message-version":"1.0.0",
 "message":{
   "facets":{},
   "total-results":57259,
   "items":[{
     "DOI":"10.3791/20970",
     "title":["CRISPR-Mediated Base Editing Tools: A Genome Editing Technique to Induce Targeted Base Substitution"],
     "issued":{"date-parts":[[2026,9,3]]},
     "container-title":["Journal of Visualized Experiments"],
     "type":"journal-article",
     "is-referenced-by-count":0,
     "ISSN":["2834-8400"],
     "URL":"https://doi.org/10.3791/20970"}],
   "items-per-page":1,
   "query":{"start-index":0,"search-terms":null}}}
```

Note `title` and `container-title` are **arrays**, and `issued.date-parts` is an
**array-of-arrays** whose inner array may have 1, 2, or 3 elements (`[[2026]]`, `[[2026,9]]`,
`[[2026,9,3]]`). Handle all three.

### 5.4 Abstracts — the big caveat

Crossref exposes abstracts in an `abstract` field as **raw JATS XML**, not plain text, and **only
when the publisher deposited one**.

> **Measured 2026-09-15 (`P0-T21`):** the 51 % whole-set figure reproduces as 22,004 / 44,152 = **49.8 %**, but the **top 100** for `CRISPR base editing` carried only **41 %**. All 41 were JATS; 3 still contained `&amp;` after JSON decoding, and abstracts can open with `<jats:title>ABSTRACT</jats:title>` — a real XML parse is required, not regex stripping.

Real response with `filter=has-abstract:true`:

```json
{"DOI":"10.1177/15357597261460897",
 "title":["Editing Out Seizures? Base Editing Shows Promise for SCN8A DEE"],
 "abstract":"<jats:p>\n  <jats:boxed-text orientation=\"portrait\" position=\"float\">\n    <jats:p>\n      <jats:bold>Base Editing Rescues Seizures and Sudden Death in a SCN8A Mutation-associated Developmental Epileptic Encephalopathy Model</jats:bold>\n    </jats:p>\n    <jats:p>SCN8A encodes the voltage-gated sodium channel Nav1.6, which plays a key role in facilitating neuronal excitability. ...</jats:p>\n  </jats:boxed-text>\n</jats:p>",
 "type":"journal-article",
 "issued":{"date-parts":[[2026,1,1]]}}
```

**Coverage:** deposition is voluntary and skews heavily by publisher (Sage, Wiley, Springer deposit;
Elsevier historically did not). Measured on the live probe above (re-run 2026-09-09), adding
`has-abstract:true` narrowed the 57,279-hit query to **29,368 — about 51 %**.

> **Unverified:** the corpus-wide abstract coverage of Crossref. The 51 % above is the rate *within
> this one recent, biomedical, `type:journal-article` query*, and recent biomedical journal articles
> are exactly where deposition is strongest. Do not generalise it to Crossref as a whole; measure
> per query if a coverage number is ever surfaced to the user.

**Handling:** strip the `jats:` namespace, unwrap `<jats:p>` into paragraph breaks, drop
`<jats:boxed-text>`/`<jats:title>` decoration, decode entities. Parse with `DOMParser` in XML mode;
regex stripping will mangle nested markup like the example above.

**Consequence for architecture:** Crossref alone is not sufficient for features 1 and 3, which need
abstracts. Use Crossref for DOI/venue authority and cross-disciplinary reach, then **backfill
abstracts from Europe PMC or Semantic Scholar by DOI** (§10.4).

### 5.5 Pagination

```
# first
GET /works?query.bibliographic=…&rows=100&cursor=*&mailto=…
# subsequent
GET /works?query.bibliographic=…&rows=100&cursor=<next-cursor>&mailto=…
```

`message.next-cursor` is returned on every page. Stop when `message.items` is empty. `offset` is
capped at 10,000 and is slow; use the cursor.

### 5.6 Errors and licensing

| Status | Meaning |
|---|---|
| 200 | OK |
| 400 | malformed filter or param — the body names the offending token |
| 404 | unknown DOI (`/works/{doi}`) |
| 429 | rate limited — back off, check `x-rate-limit-*` |
| 504 | timeout on a heavy query — reduce `rows`, add `select` |

**Licensing:** Crossref metadata is released with **no copyright restriction** and is freely
reusable, including commercially. Abstracts within it carry publisher copyright — the same caution
as elsewhere applies. Crossref asks that you not present its data as authoritative beyond what
publishers deposited.

---

## 6. Semantic Scholar Academic Graph API

### 6.1 Base URLs

```
https://api.semanticscholar.org/graph/v1              # Academic Graph
https://api.semanticscholar.org/recommendations/v1    # Recommendations
```

### 6.2 Endpoints

Confirmed against the live Swagger spec (`/graph/v1/swagger.json`, fetched 2026-09-08):

| Path | Method | Purpose |
|---|---|---|
| `/paper/search` | GET | relevance-ranked search, `limit ≤ 100` |
| `/paper/search/bulk` | GET | bulk retrieval with real query syntax, token pagination |
| `/paper/search/match` | GET | single best title match — **ideal for DOI-less dedup lookups** |
| `/paper/{paper_id}` | GET | one paper, all fields |
| `/paper/batch` | POST | up to 500 IDs in one call |
| `/paper/{paper_id}/citations` | GET | inbound citations, `limit ≤ 1000` |
| `/paper/{paper_id}/references` | GET | outbound references, `limit ≤ 1000` |
| `/paper/autocomplete` | GET | typeahead |
| `/snippet/search` | GET | passage-level retrieval from full texts |
| `/author/*` | GET/POST | author records |
| `/recommendations/v1/papers/` | POST | positive + negative example papers |
| `/recommendations/v1/papers/forpaper/{paper_id}` | GET | single seed paper |

### 6.3 Paper ID formats

Every `{paper_id}` slot accepts:

| Form | Example |
|---|---|
| S2 SHA | `649def34f8be52c8b66281af98ae884c09aef38b` |
| `CorpusId:` | `CorpusId:215416146` |
| `DOI:` | `DOI:10.18653/v1/N18-3011` |
| `ARXIV:` | `ARXIV:2106.15928` |
| `MAG:` | `MAG:112218234` |
| `ACL:` | `ACL:W12-3903` |
| `PMID:` | `PMID:19872477` |
| `PMCID:` | `PMCID:2323736` |
| `URL:` | `URL:https://arxiv.org/abs/2106.15928v1` (semanticscholar.org, arxiv.org, aclweb.org, acm.org, biorxiv.org) |

This is the **best cross-ID resolver of any source in this document** — it accepts a DOI, PMID, or
arXiv ID interchangeably and returns all the others in `externalIds`. Use it as the dedup fallback
when the PMC converter can't help (non-biomedical papers).

### 6.4 Auth and rate limits — **read this before designing anything**

| Item | Value |
|---|---|
| Key required? | Technically no; **practically yes** |
| Header | `x-api-key: <key>` |
| Obtain | Form at https://www.semanticscholar.org/product/api#api-key-form; key arrives by e-mail |
| Unauthenticated | **1000 req/s shared across every anonymous user on the internet** |
| Authenticated | **1 req/s** introductory, across all endpoints |
| Cost | Free |

**Live evidence (2026-09-08):** unauthenticated requests to `/paper/search` returned HTTP **429**
on the first attempt, again after an 8-second wait, and again after a further 20 seconds:

```
HTTP/1.1 429
x-amzn-ErrorType: TooManyRequestsException
{"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limits. https://www.semanticscholar.org/product/api#api-key-form", "code": "429"}
```

Subsequent calls succeeded intermittently. **The shared anonymous pool is saturated during business
hours.** Any feature built on unkeyed Semantic Scholar access will be unreliable.

**Second measurement (2026-09-09 21:46 UTC, task `P0-T22`).** Re-measured 24 hours later with
12 requests over 72 seconds, spaced 1.2 s / 8 s / 20 s / 30 s: **HTTP 429 on all twelve, zero
successes**, at an average rate of roughly one request per 6 s — far below the 0.9 req/s budget
§2.4 sets for this host. The body was byte-identical to the block above on every response
(`content-length: 174`), as was `x-amzn-ErrorType`. Everything above reproduces exactly.

Three details the first measurement did not capture, all of which Phase 2's error mapping needs:

- **There is no `Retry-After` header.** §2.4's universal policy reads "honour `Retry-After` if
  present, else back off with jitter" — for Semantic Scholar the else-branch is the only branch
  that ever runs.
- **`code` is the JSON *string* `"429"`, not the number**, and the 429 body carries `message`,
  not the `error` key that §6.10 documents for 400/404. One S2 decoder has to accept both shapes.
- **`statusText` is empty** (HTTP/2 carries no reason phrase). Nothing may match on it.

The "succeeded intermittently" clause above was **not** reproduced — 0 of 12 in a 72-second
window. That window is too small to disprove "intermittently", so the clause stands, but read it
as a single-session observation rather than an expectation. Note also that 21:46 UTC is 14:46
US-Pacific, inside US business hours; nothing here says anything about off-peak behaviour, and
no feature should be designed on the hope that off-peak is better.

**Design decisions this forces:**

1. Ship an in-app prompt asking the user to obtain a free S2 key, with a deep link to the form,
   shown the first time a Semantic Scholar-backed feature is used.
2. The keyed limit of **1 req/s is the binding constraint on feature 2 and feature 6.** Design
   around `/paper/batch` (500 IDs/call) and `limit=1000` on citations/references rather than
   per-paper loops. A naive "fetch references for each of 50 papers" costs 50 seconds; batching the
   metadata afterwards costs 1 more.
3. Cache aggressively (§ doc 05).
4. Always degrade gracefully to Europe PMC citations when S2 429s.

### 6.5 `/paper/search` — relevance search

Parameters (from the live spec):

| Param | Notes |
|---|---|
| `query` | **plain text only — no query syntax.** Hyphenated terms yield no matches; replace hyphens with spaces |
| `fields` | comma-separated; `paperId` always returned; omitting it returns only `paperId` + `title` |
| `year` | `2019`, `2016-2020`, `2010-`, `-2015` |
| `publicationDateOrYear` | `<start>:<end>` in `YYYY-MM-DD`, prefixes allowed (`2020-06`), open-ended (`1981-08-25:`, `:2015-01`) |
| `venue` | comma-separated, accepts ISO4 abbreviations |
| `fieldsOfStudy` | 23 values incl. Computer Science, Medicine, Biology, Physics, … |
| `publicationTypes` | Review, JournalArticle, CaseReport, ClinicalTrial, Conference, Dataset, Editorial, LettersAndComments, MetaAnalysis, News, Study, Book, BookSection |
| `openAccessPdf` | valueless flag |
| `minCitationCount` | integer |
| `offset` / `limit` | `limit ≤ 100`; offset+limit capped at 1000 |

#### Date-range filtering — "last 3 years"

```
&year=2023-2026
# or, precise:
&publicationDateOrYear=2023-09-08:2026-09-08
```

Caution from the spec: records without a known specific date "will be treated as if published on
January 1st of their publication year," and `publicationDate` may be `null` even when the filter
matched.

### 6.6 `/paper/search/bulk` — the one with real query syntax

Unlike `/paper/search`, the bulk endpoint supports operators:

| Operator | Meaning |
|---|---|
| `+` | AND |
| `\|` | OR |
| `-` | NOT |
| `"…"` | phrase |
| `*` | prefix |
| `( )` | precedence |
| `~N` | fuzzy (edit distance N, default 2) / phrase slop |

Examples from the spec: `fish ladder` (both terms), `fish -ladder`, `fish | ladder`,
`"fish ladder"`, `(fish ladder) | outflow`, `fish~`, `"fish ladder"~3`.

`sort` accepts `paperId`, `publicationDate`, `citationCount` as `field:order`
(e.g. `citationCount:desc`). Pagination is by opaque `token`, not offset. **Use bulk for feature 1
and feature 6 candidate generation; use `/paper/search` only when relevance ranking matters more
than recall.**

### 6.7 `/paper/{id}` — real response

```
https://api.semanticscholar.org/graph/v1/paper/DOI:10.1038/s41586-023-06139-9
  ?fields=title,abstract,year,externalIds,venue,citationCount,referenceCount,influentialCitationCount,tldr,publicationTypes,publicationDate,openAccessPdf,journal,authors
```

```json
{
  "paperId": "7d1e59ce254bea5228da634dbe7c5c4160df6f98",
  "externalIds": { "PubMedCentral": "10949956", "DOI": "10.1038/s41586-023-06139-9",
                   "CorpusId": 259002047, "PubMed": "37258680" },
  "title": "Transfer learning enables predictions in network biology",
  "venue": "Nature",
  "year": 2023,
  "referenceCount": 159,
  "citationCount": 1220,
  "influentialCitationCount": 137,
  "openAccessPdf": {
    "url": "https://escholarship.org/content/qt8st2d5mx/qt8st2d5mx.pdf",
    "status": "GREEN", "license": null,
    "disclaimer": "Notice: Paper or abstract available at https://pmc.ncbi.nlm.nih.gov/articles/PMC10949956, which is subject to the license by the author or copyright owner provided with this content. ..." },
  "tldr": { "model": "tldr@v2.0.0",
            "text": "A context-aware, attention-based deep learning model pretrained on single-cell transcriptomes enables predictions in settings with limited data in network biology and could accelerate discovery of key network regulators and candidate therapeutic targets." },
  "publicationTypes": ["JournalArticle"],
  "publicationDate": "2023-05-31",
  "journal": { "name": "Nature", "pages": "616 - 624", "volume": "618" },
  "authors": [ { "authorId": "4401918", "name": "C. Theodoris" },
               { "authorId": "2218974530", "name": "Ling Xiao" },
               { "authorId": "4504266", "name": "P. Ellinor" } ],
  "abstract": "Mapping gene networks requires large amounts of transcriptomic data to learn the connections between genes, ..."
}
```

**Full `fields` list** (from the live spec's `FullPaper` definition): `paperId`, `corpusId`,
`externalIds`, `url`, `title`, `abstract`, `venue`, `publicationVenue`, `year`, `referenceCount`,
`citationCount`, `influentialCitationCount`, `isOpenAccess`, `openAccessPdf`, `fieldsOfStudy`,
`s2FieldsOfStudy`, `publicationTypes`, `publicationDate`, `journal`, `citationStyles`, `authors`,
`citations`, `references`, `embedding`, `tldr`, `textAvailability`.

**Two fields deserve special attention:**

- **`tldr`** — a machine-generated one-sentence summary (SciTLDR model). For feature 3, this is a
  free, zero-token pre-summary. Use it to build a fast collection overview before spending LLM
  tokens, and as a fallback when an abstract is missing.
- **`embedding.specter_v2`** — see §6.9.

**Author names are abbreviated** (`"C. Theodoris"`, `"P. Ellinor"`) where PubMed gives
`Theodoris, Christina V`. **Prefer PubMed/Europe PMC/Crossref author names over S2's** in the merge
precedence rules (§11.5).

### 6.8 `/paper/batch` — the throughput lever

```
POST https://api.semanticscholar.org/graph/v1/paper/batch?fields=title,abstract,externalIds,year,citationCount,tldr
Content-Type: application/json

{"ids": ["DOI:10.1038/s41586-023-06139-9", "PMID:37258680", "ARXIV:2106.15928", "CorpusId:215416146"]}
```

Returns an array positionally aligned with `ids`; **unknown IDs come back as `null` entries**, so
index-match rather than assuming a 1:1 non-null mapping. Documented max **500 IDs** per call. The
whole response must stay under **10 MB** or you get a 400 (`"Response would exceed maximum
size…"`) — with `abstract` requested, keep batches to ~100 IDs.

### 6.9 `embedding.specter_v2`

**Verified live 2026-09-08:**

```
GET /graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=title,embedding.specter_v2
```
```json
{"paperId": "7d1e59ce254bea5228da634dbe7c5c4160df6f98",
 "title": "Transfer learning enables predictions in network biology",
 "embedding": {"model": "specter_v2",
   "vector": [0.7878396511077881, 0.8180338740348816, -0.29438433051109314, -0.184433475136, ... ]}}
```

Measured: **768 dimensions**, ~16 KB of JSON per paper. Requesting `embedding` (without the
suffix) yields SPECTER **v1**; `embedding.specter_v2` is what you want. Storage and similarity
strategy are covered in doc 05 §5.4.

### 6.10 Errors and licensing

| Status | Meaning |
|---|---|
| 200 | OK |
| 400 | `{"error": "Unrecognized or unsupported fields: [...]"}` or `"Response would exceed maximum size…"` (>10 MB) |
| 404 | `{"error": "Paper with id ### not found"}` |
| **429** | rate limited — **expect this constantly without a key** |

**Licensing:** the Semantic Scholar API is governed by the Semantic Scholar API License Agreement
and Allen Institute for AI terms. Metadata is broadly reusable with attribution; abstracts carry the
caveat printed in the spec itself — "due to legal reasons, this may be missing even if we display an
abstract on the website" — and `openAccessPdf.disclaimer` carries a per-record licensing notice that
should be preserved in the Zotero `rights` field when present.

> **Unverified:** the precise licence identifier (ODC-BY vs. a bespoke agreement) for API-delivered
> metadata could not be confirmed from the public product page; the linked License Agreement should
> be reviewed by whoever signs off on distribution before release.

---

## 7. arXiv API

### 7.1 Base URL and auth

```
https://export.arxiv.org/api/query
```

| Item | Value |
|---|---|
| API key | None — none exists |
| Cost | Free |
| **Rate limit** | **1 request per 3 seconds, single connection at a time** |
| Response format | Atom 1.0 XML only (no JSON) |
| CORS | **No `Access-Control-Allow-Origin` header** (verified) |

> **Measured 2026-09-15 (`P0-T21`): arXiv can answer HTTP 429, which this section did not document.** Every one of 7 requests over ~14 minutes, spaced at least 30 s apart and the first of the session, returned `HTTP/1.1 429 Unknown Error` from `server: Google Frontend` with `content-type: text/html`, a 14-byte body `Rate exceeded.`, and **no `Retry-After`**; some took up to 46 s to fail. The 3-second rule was obeyed. Whether the limit keyed on this network's shared address or is global could not be determined. The adapter needs a path for an HTML 429 with no `Retry-After` — distinct from the HTTP-200 error feeds described below — and the measurement should be repeated from another network before Phase 2 depends on arXiv volume.

The Terms of Use are explicit: make "no more than one request every three seconds, and limit
requests to a single connection at a time," and this applies to "all of the machines under your
control as a whole." ([arXiv API ToU](https://info.arxiv.org/help/api/tou.html))

**This is the tightest limit of any source and it is a hard ToU obligation, not advice.** A search
returning 200 arXiv results at 100/page costs 6 seconds minimum. Budget for it in the UI: show a
progress indicator, and never issue arXiv calls inside a per-item loop.

Use `https://` (verified working). Plain `http://export.arxiv.org` answers **HTTP 301** with an
empty body, redirecting to the `https://` URL — so a client that does not follow redirects sees
nothing at all. Call the `https://` URL directly rather than relying on redirect following.

### 7.2 Parameters

| Param | Notes |
|---|---|
| `search_query` | field-prefixed query |
| `id_list` | comma-separated arXiv IDs (can combine with `search_query` to filter within a set) |
| `start` | 0-based offset |
| `max_results` | per page; **slices of at most 2000**, 30,000 total per query |
| `sortBy` | `relevance`, `lastUpdatedDate`, `submittedDate` |
| `sortOrder` | `ascending`, `descending` |

Field prefixes: `ti:` title, `au:` author, `abs:` abstract, `co:` comment, `jr:` journal reference,
`cat:` category, `rn:` report number, `id:` ID, `all:` any of the above.

Boolean operators: `AND`, `OR`, `ANDNOT`. Grouping with `(` `)` (URL-encode as `%28`/`%29`),
phrases with `"` (`%22`).

### 7.3 Date-range filtering — "last 3 years"

`submittedDate` (and `lastUpdatedDate`) take a range in **`[YYYYMMDDTTTT TO YYYYMMDDTTTT]`** format
where `TTTT` is a 24-hour GMT time:

```
search_query=cat:q-bio.GN+AND+submittedDate:[202309080000+TO+202609082359]
```

URL-encoded (`[`→`%5B`, `]`→`%5D`, space→`+`):

```
https://export.arxiv.org/api/query?search_query=cat:q-bio.GN+AND+submittedDate:%5B202309080000+TO+202609082359%5D&start=0&max_results=1&sortBy=submittedDate&sortOrder=descending
```

**Gotcha discovered in testing:** arXiv echoes the range back with the brackets converted to
double quotes — `submittedDate:"202401010000 TO 202612312359"` — in the feed `<title>`. This is
cosmetic; the filter applies correctly. Don't be alarmed by it, and don't try to send quotes
yourself.

`submittedDate` filters on **v1 submission**, so a paper submitted in 2022 and revised in 2025 is
*excluded* by a 3-year `submittedDate` window but included by `lastUpdatedDate`. For "recent
research," `submittedDate` is the right choice; expose `lastUpdatedDate` as an option for users
tracking revised work.

### 7.4 Real request and response

```
https://export.arxiv.org/api/query?search_query=cat:q-bio.GN+AND+submittedDate:%5B202401010000+TO+202612312359%5D&start=0&max_results=1&sortBy=submittedDate&sortOrder=descending
```

```xml
<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom"
      xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/mJHbTmghw9nrPaloKH3cf3K1Xl8</id>
  <title>arXiv Query: search_query=cat:q-bio.GN AND submittedDate:"202401010000 TO 202612312359"&amp;id_list=&amp;start=0&amp;max_results=1</title>
  <updated>2026-09-08T07:30:02Z</updated>
  <link href="https://arxiv.org/api/query?search_query=..." type="application/atom+xml"/>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <opensearch:totalResults>927</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/2609.04658v1</id>
    <title>VizIt: A multi-view framework for exploring single-cell, spatial, and genetic data online</title>
    <updated>2026-09-04T02:40:47Z</updated>
    <published>2026-09-04T02:40:47Z</published>
    <link href="https://arxiv.org/abs/2609.04658v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2609.04658v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>Multi-omic studies increasingly require data to be examined from complementary
      biological perspectives, yet interactive exploration remains fragmented across modalities
      and tools. We present VizIt, an open-source framework for multi-view exploration of
      single-cell and spatial transcriptomic, epigenomic and genetic data. ...</summary>
    <category term="cs.IR" scheme="http://arxiv.org/schemas/atom"/>
    <category term="q-bio.GN" scheme="http://arxiv.org/schemas/atom"/>
    <arxiv:primary_category term="cs.IR"/>
    <author><name>Chenhang Christopher Zhang</name></author>
    <author><name>Yanqing Lou</name></author>
    <author><name>Xianjun Dong</name></author>
  </entry>
</feed>
```

Additional entry-level elements that appear when present:
`<arxiv:comment>` (e.g. "12 pages, 5 figures"), `<arxiv:journal_ref>` (post-publication venue),
`<arxiv:doi>` (the *published* DOI, not the arXiv DOI), `<link title="doi">`.

### 7.5 Atom parsing notes

```js
const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
const ATOM = 'http://www.w3.org/2005/Atom';
const ARXIV = 'http://arxiv.org/schemas/atom';
const OS = 'http://a9.com/-/spec/opensearch/1.1/';
const total = +doc.getElementsByTagNameNS(OS, 'totalResults')[0].textContent;
for (const e of doc.getElementsByTagNameNS(ATOM, 'entry')) { /* … */ }
```

1. **Namespaces are mandatory.** `getElementsByTagName('entry')` fails; use the NS variants.
2. **`<summary>` is hard-wrapped** with newlines and leading spaces. Normalise:
   `text.replace(/\s+/g, ' ').trim()`.
3. **`<title>` also wraps** for long titles. Same normalisation.
4. **Extract the arXiv ID** from `<id>`: `http://arxiv.org/abs/2609.04658v1` → id `2609.04658`,
   version `1`. Strip the version for cross-source matching, keep it for the Zotero `archiveID`.
5. **Every arXiv paper has a DataCite DOI** of the form `10.48550/arXiv.<id>` (not present in the
   feed — construct it). If `<arxiv:doi>` is present it is the **journal** DOI, meaning the preprint
   has been published — this is a direct preprint↔published link (§11.4).
6. **Error responses are also Atom feeds** with a single entry whose `<title>` is `Error` and whose
   `<summary>` describes the problem — HTTP status stays 200. Check for
   `entry/id == "http://arxiv.org/api/errors"`.
7. `<opensearch:totalResults>` can be `0` with no `<entry>` elements — normal empty result.

### 7.6 Licensing

arXiv **metadata** (titles, abstracts, authors) is released under **CC0 1.0** and may be freely
retrieved, stored, transformed, and shared. **Full texts are not** — the ToU state you "must not
store and serve arXiv e-prints (PDFs, source files, or other content)" without permission, since
most submissions use the arXiv non-exclusive distribution licence rather than an open licence.

For research_helper: importing metadata + abstract into a user's Zotero library is unambiguously
fine. Downloading a PDF *into the user's own library for their own use* is the normal Zotero
behaviour and is fine; do not build any redistribution or server-side caching of PDFs.

---

## 8. bioRxiv / medRxiv APIs

### 8.1 Base URL and auth

```
https://api.biorxiv.org
```

No key, no cost, **no documented rate limit and no published terms of use for the API**. Treat
conservatively: 1 req/s, single connection.

`Access-Control-Allow-Origin: *` (verified).

### 8.2 Endpoints

| Endpoint | Template | Page size |
|---|---|---|
| `/details/` | `/details/{server}/{interval}/{cursor}/{format}` or `/details/{server}/{DOI}/na/{format}` | **30** |
| `/pubs/` | `/pubs/{server}/{interval}/{cursor}` or `/pubs/{server}/{DOI}/na/{format}` | 100 |
| `/pub/` | `/pub/{interval}/{cursor}/{format}` (bioRxiv only) | 100 |
| `/publisher/` | `/publisher/{doi-prefix}/{interval}/{cursor}` | 100 |
| `/funder/` | `/funder/{server}/{interval}/{ror}/{cursor}/{format}` | 100 |
| `/sum/`, `/usage/` | aggregate statistics | — |

`{server}` ∈ `biorxiv`, `medrxiv`. `{interval}` is `YYYY-MM-DD/YYYY-MM-DD`, an integer (N most
recent), `Nd` (last N days), or a DOI followed by `/na`.

### 8.3 Real responses

**`/details/` — 30 records/page, abstracts included:**

```
https://api.biorxiv.org/details/biorxiv/2026-08-01/2026-08-02/0/json
```
```json
{"messages":[{"status":"ok","category":"all","interval":"2026-08-01:2026-08-02",
              "cursor":0,"count":30,"count_new_papers":"77","total":"109"}],
 "collection":[
  {"title":"Sound-shape correspondences in macaques reveal evolutionary roots of sound symbolism",
   "authors":"Loconsole, M.; Xue, C.; Garcia-Pelegrin, E.",
   "author_corresponding":"Maria Loconsole",
   "author_corresponding_institution":"University of Padova",
   "doi":"10.64898/2026.07.31.741992",
   "date":"2026-08-01","version":"1","type":"new results","license":"cc_by_nc_nd",
   "category":"animal behavior and cognition",
   "jatsxml":"https://www.biorxiv.org/content/early/2026/08/01/2026.07.31.741992.source.xml",
   "abstract":"Humans reliably associate certain speech-like sounds with visual shapes, most notably in the Bouba-Kiki Effect, where rounded and spiky shapes are matched with the sounds Bouba and Kiki, respectively. ...",
   "funder":"NA","published":"NA","server":"bioRxiv"}]}
```

**`/pubs/` — the preprint→published cross-walk, invaluable for dedup:**

```
https://api.biorxiv.org/pubs/biorxiv/2026-06-01/2026-06-05/0/json
```
```json
{"messages":[{"status":"ok","interval":"2026-06-01:2026-06-05","cursor":0,"count":100,"total":"469"}],
 "collection":[
  {"preprint_doi":"10.1101/2025.09.17.676679",
   "published_doi":"10.1091/mbc.E25-09-0454",
   "published_journal":"Molecular Biology of the Cell",
   "preprint_platform":"bioRxiv",
   "preprint_title":"YeastSAM: A Deep Learning Model for Accurate Segmentation of Budding Yeast Cells",
   "preprint_authors":"Zhao, Y.; Zhu, Z.; Yang, S.; Li, W.",
   "preprint_category":"cell biology",
   "preprint_date":"2025-09-20","published_date":"2026-06-01",
   "preprint_abstract":"An essential step for quantitative image analysis is cell segmentation, ...",
   "preprint_author_corresponding":"Weihan Li",
   "preprint_author_corresponding_institution":"The Department of Molecular Biology, Cell Biology & Biochemistry, Brown University, Providence, RI 02912, USA"}]}
```

**Abstracts are present** in both `/details/` (`abstract`) and `/pubs/` (`preprint_abstract`).
`/pub/` and `/publisher/` do **not** include abstracts.

### 8.4 The fatal limitation: **there is no keyword search**

The bioRxiv API can filter by **date range, category, funder, and publisher DOI prefix — but not by
topic**. To find preprints about "base editing" you would have to download every preprint in the
window (109 papers in a *two-day* window in the probe above → roughly 20,000 per year) and filter
client-side. At 30 records per request and 1 req/s, a 3-year sweep is **~2,000 requests / 35
minutes**. That is not a viable interactive feature.

**Recommendation — route preprints through Europe PMC (primary) and Crossref (secondary):**

| Need | Route |
|---|---|
| **Keyword search of preprints** | **Europe PMC `SRC:PPR`** — indexed, searchable, abstracts inline, same code path as everything else |
| Cross-disciplinary preprints (not just bio) | Crossref `filter=type:posted-content` |
| Preprint → published version link | **bioRxiv `/pubs/` by DOI**, or Crossref `relation.is-preprint-of`, or the `published` field in `/details/` |
| Latest preprints in a category (browse) | bioRxiv `/details/{server}/30d/0/json?category=…` |
| Metadata for a *known* preprint DOI | bioRxiv `/details/{server}/{DOI}/na/json` |

Keep the bioRxiv adapter, but scope it to **ID-based lookup and preprint↔published resolution only**,
not to search.

**What this means in the UI (decided 2026-09-09).** Both servers ship **enabled** in the `sources`
default, because FR-2 requires all seven as user-visible choices and because the adapters do real
work on every run — just not searching. `08-ui-ux-spec.md` §4.2 owns the consequence: the per-source
status block must render their **role** (`⊕ ID lookup · preprint matching`) and never a count, a
spinner, or a zero result, so that "no search results" is not mistaken for "broken". Shipping them
unchecked was rejected: it hides the limitation rather than explaining it, and a user who ticks the
box then gets nothing back with no explanation at all.

### 8.5 Errors and licensing

Errors arrive as `{"messages":[{"status":"error", ...}]}` inside HTTP 200. Check
`messages[0].status === "ok"`.

Per-record `license` (`cc_by`, `cc_by_nc_nd`, `cc0`, `cc_by_nd`, or absent) should be copied into
the Zotero `rights` field. There is no published API ToU; bioRxiv/medRxiv content is generally
available for text mining. **Unverified:** whether any rate limit is enforced — none was observed
during testing, but absence of enforcement is not permission.

> **Measured 2026-09-15 (`P0-T21`): a third error shape, and `/details` broken.** Every `/details` request — including §8.3's own documented URL `…/details/biorxiv/2026-08-01/2026-08-02/0/json` and a DOI lookup `…/details/biorxiv/10.64898/2026.07.31.741992/na/json` — returned **HTTP 200 with an empty body** (`content-length: 0`), while `/pubs/` worked with the same `User-Agent`. An adapter must treat an empty 200 body as a failure, not as "no results". `/pubs/`'s not-found message is free text (`"no articles found for published version of "`, with the DOI missing), not `status: "error"`. §8.2's `/pubs/{server}/{interval}/{cursor}` template omits the `/{format}` segment that §8.3's working example carries. Abstract text from `/pubs/` contains flattening tokens (`O_SCPCAP…C_SCPCAP`, `C_LIO_LI`, sometimes glued to a letter as in `AO_SCPCAPBSTRACT`) and section headings run into the prose ("BackgroundAs…"); the normalizer must strip both. Re-probe `/details` on another day before the v1 ID-lookup role relies on it.

---

## 9. OpenAlex — evaluation and recommendation

> **Verdict first: OpenAlex is out of v1.** §9.3 records the decision and why this evaluation is
> nevertheless kept. Nothing in §9.1 or §9.2 authorises building an adapter.

### 9.1 What changed in 2026 (this is the headline)

OpenAlex was, until recently, the obvious free supplement: no key, generous limits, complete
coverage. **That is no longer true.**

As of **February 2026**, OpenAlex requires an API key for production use and meters calls with
**usage-based pricing**. ([OpenAlex blog, 2026-02-24](https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/))

**Verified live 2026-09-08** — an unauthenticated request returns metering in both the body and the
headers:

```json
{"meta": {"count": 327595274, "db_response_time_ms": 148, "page": 1, "per_page": 1,
          "x_query": {"oql": "works", "oqo": {"get_rows": "works"}, "url": "/works?per_page=1"},
          "cost_usd": 0.0001},
 "results": [{"id": "https://openalex.org/W3038568908"}]}
```
```
X-RateLimit-Cost-USD: 0.0001
X-RateLimit-Credits-Used: 1
X-RateLimit-Limit: 1000
X-RateLimit-Limit-USD: 0.1
X-RateLimit-Remaining: 989
X-RateLimit-Remaining-USD: 0.0989
X-RateLimit-Prepaid-Remaining-USD: 0
X-RateLimit-Reset: 58798
```

| Tier | Daily budget | Practical meaning |
|---|---|---|
| **No key** | **$0.10/day** | ~1,000 list calls **shared per IP**, or 100 searches |
| **Free key** | **$1.00/day** | ~10,000 list calls, 1,000 searches, or 100 PDF fetches |
| Prepaid / annual | pay-as-you-go | credit card or org plan |

Per-call pricing: single work lookup **$0.00**, list/filter **$0.0001**, search **$0.001**,
PDF/XML download **$0.01**.

Key transmission — **both mechanisms verified** (each returns 401 for an invalid key, confirming
both are parsed):

```
GET https://api.openalex.org/works?…&api_key=<KEY>
# or
Authorization: Bearer <KEY>
```

The old `mailto=` polite pool is superseded. `Access-Control-Allow-Origin: *`.

### 9.2 What OpenAlex still does well

```
https://api.openalex.org/works
  ?filter=from_publication_date:2023-01-01,title_and_abstract.search:base%20editing
  &per-page=1
  &select=id,doi,title,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index,type,ids
```

```json
{"meta": {"count": 55568, "db_response_time_ms": 179, "page": 1, "per_page": 1, "cost_usd": 0.001},
 "results": [{
   "id": "https://openalex.org/W4380563796",
   "doi": "https://doi.org/10.1056/nejmoa2300709",
   "title": "Base-Edited CAR7 T Cells for Relapsed T-Cell Acute Lymphoblastic Leukemia",
   "publication_year": 2023,
   "authorships": [{
     "author_position": "first",
     "author": {"id": "https://openalex.org/A5090643085", "display_name": "Robert Chiesa",
                "orcid": "https://orcid.org/0000-0001-9323-0259"},
     "institutions": [{"id": "https://openalex.org/I2800129641",
                       "display_name": "Great Ormond Street Hospital",
                       "ror": "https://ror.org/00zn2c847", "country_code": "GB",
                       "type": "healthcare"}],
     "countries": ["GB"], "is_corresponding": false,
     "raw_author_name": "Robert Chiesa"}]
 }]}
```

Strengths: 327 M works, richest institution/ORCID/ROR data of any source, `referenced_works` and
`cited_by_api_url` for citation graphs, a `related_works` field, and an excellent filter language
(`from_publication_date`, `title_and_abstract.search`, `type`, `is_oa`, `concepts.id`, …).

**Abstracts are stored as an inverted index**, not text, and must be reconstructed:

```ts
function reconstructAbstract(inv: Record<string, number[]> | null): string | null {
  if (!inv) return null;
  const positions: string[] = [];
  for (const [word, idxs] of Object.entries(inv)) for (const i of idxs) positions[i] = word;
  return positions.join(' ').replace(/\s+/g, ' ').trim() || null;
}
```
This is lossy on punctuation and case-sensitive tokenisation, and produces text that is *readable*
but not identical to the publisher's abstract. **Prefer any other source's abstract over
OpenAlex's.**

### 9.3 Recommendation

**OpenAlex is out of scope for v1. It ships no adapter, no preference, no `SecretId` and no
rate-limit policy row. The evaluation above is retained as v1.1 research.**

This section formerly recommended shipping OpenAlex as an opt-in supplementary source, disabled by
default. That recommendation is **withdrawn** because it contradicted two stronger records: decision
**D2** in `00-overview.md` §3, which fixes the v1 source list and does not include OpenAlex, and
`10-requirements-and-user-stories.md` §4 item 10, which places it out of scope and names it "the
most likely v1.1 addition". A confirmed decision and a scope statement outrank a technical
recommendation in this corpus, and point 1 of the retained evaluation below argues against a
client-side default-on design anyway. Nothing in this document contradicted D2 on the substance —
only on the verdict.

**Why the research is kept rather than deleted.** §9.1 and §9.2 are the only place in the corpus
that records what OpenAlex costs and what it is good for, and both are perishable: the February 2026
metering change, the verified per-call prices, the two working key-transmission mechanisms, the
inverted-index abstract reconstruction, and the fact that the `mailto=` polite pool is superseded.
When OpenAlex is reconsidered for v1.1, that is the evidence the decision needs, and re-deriving it
means re-running live probes. Deleting a finished evaluation because its verdict changed is how the
same question gets researched twice.

**What "reconsider in v1.1" costs, so the estimate is not a surprise.** Beyond the adapter itself:
a new `SecretId` in `09-security-privacy-and-api-keys.md` §1.7 (§2.3 of this document already says
so), an `openalex.keyPresent` row in `07-architecture-and-data-model.md` §8.5, an
`api.openalex.org` row in `07-architecture-and-data-model.md` §7.3, a budget-exhausted UI state, and
asking the user for a **third** API key after Semantic Scholar and their LLM provider. Those three
document rows go in **before** any code (`07-architecture-and-data-model.md` §11.1 steps 4 and 9).

The evaluation that produced the withdrawn recommendation, kept for that decision:

1. **The metering is fatal to a default-on, client-side design.** Without a key, all users of the
   plugin behind one institutional NAT share a $0.10/day budget — feature 6 could exhaust it in a
   single run. Every user would need their own key for the feature to be reliable, and that is a
   third key to ask for after Semantic Scholar and their LLM provider.
2. **Everything OpenAlex offers is available elsewhere free.** Search → Europe PMC + Crossref.
   Citations → Semantic Scholar + Europe PMC. Recommendations → Semantic Scholar. Institution data
   → not needed for any of the six features.
3. **Abstract quality is the worst of any source** (reconstructed from an inverted index).
4. **It is genuinely the best coverage.** For a user researching in a field poorly served by
   PubMed/arXiv (humanities, social sciences, non-English literature), OpenAlex is materially better
   than the alternatives. That is the standing argument for revisiting it in v1.1 — and the reason
   this evaluation is kept rather than deleted.

**Implementation sketch, for v1.1 if the source is ever adopted** — not a v1 instruction: ship the
adapter, gate it behind membership in the `sources` preference plus an API-key field backed by the
keystore, read `X-RateLimit-Remaining-USD` after every call, and surface a clear "OpenAlex daily
budget exhausted" message rather than a generic error. When the budget is gone, silently fall back
to the free sources. **Under no outcome is OpenAlex enabled by default** — point 1 above is the
reason.

**Licensing:** the underlying OpenAlex dataset is **CC0** and remains free to download and reuse —
only *API access* is metered. There are no attribution or redistribution constraints on the data
itself.

---

## 10. Cross-source normalization

### 10.1 Canonical internal record

Every adapter maps its native response into exactly this shape. Nothing downstream — dedup, scoring,
LLM summarization, Zotero writing — sees a source-native object.

> **Naming, reconciled.** This document calls the type `CanonicalRecord`;
> `07-architecture-and-data-model.md` §5.1 calls the shipped type **`CanonicalWork`** and is
> authoritative for it, including the field names (`CanonicalRecord.key` is
> `CanonicalWork.workKey`, and doc 07 prefixes the key with its ID scheme — `doi:<doi>`,
> `pmid:<pmid>`, … — where this section writes the bare value). The shape below is the
> source-adapter view used by the mapping tables in §10.2 and by doc 05; treat any divergence from
> doc 07 §5.1 as a defect in this document, not in doc 07.
>
> **The same applies to the two unions the block opens with**, which are the only other names here
> that doc 07 also declares. `SourceId` lives in doc 07 §5.1 — not in `sources/types.ts` — and both
> adapter modules re-export it; the copy below must stay identical to it, `medrxiv` included.
> `WorkType` is doc 07 §5.1's as well, and its *shipped* values are that section's kebab-case union,
> not the five Zotero item-type spellings used below; doc 07 §6.2 owns the mapping between them. The
> labels below are this document's working names for §10.2's mapping rules and §10.3's Zotero write,
> not a second type to declare in code.

```ts
/**
 * Which API produced this record. Declared by `07-architecture-and-data-model.md` §5.1,
 * which owns the union and from which the adapter modules re-export it; repeated here only
 * so this section reads on its own. It must list every source this document documents —
 * `medrxiv` is a separate member from `biorxiv` because §8's server detection uses the
 * publisher/server field, never the shared `10.64898/` DOI prefix.
 *
 * `openalex` is RESERVED, not shipped — OpenAlex is out of v1 (§9.3, decision D2). Doc 07
 * §5.1 states the rules that follow; the OpenAlex columns and precedence entries elsewhere
 * in this document are retained v1.1 research and are inert in v1.
 */
export type SourceId =
  | 'pubmed' | 'europepmc' | 'crossref' | 'semanticscholar'
  | 'arxiv' | 'biorxiv' | 'medrxiv' | 'openalex';

/**
 * Working labels for the record's publication type, used by §10.2's mapping rules and by
 * §10.3's Zotero write. They are deliberately the Zotero item-type spellings, because that
 * is what §10.3 sets. The *shipped* `WorkType` union is
 * `07-architecture-and-data-model.md` §5.1's (`"journal-article" | "preprint" |
 * "conference-paper" | "review" | "book-chapter" | "dataset" | "thesis" | "report" |
 * "other"`), and doc 07 §6.2 owns the mapping from it onto Zotero item types. Where the two
 * disagree, doc 07 wins and this is the defect; do not declare a second `WorkType` in code.
 */
export type WorkType = 'journalArticle' | 'preprint' | 'conferencePaper' | 'bookSection' | 'other';

export interface CanonicalAuthor {
  /** Family name. Required — if a source gives only a full string, split it. */
  lastName: string;
  /** Given name(s) or initials. May be '' for corporate/collective authors. */
  firstName: string;
  /** Set when the source gave an unsplittable single string (e.g. a consortium). */
  literal?: string;
  orcid?: string;
  affiliations?: string[];
  /** True for consortium/group authors → Zotero fieldMode 1. */
  isInstitutional?: boolean;
}

export interface CanonicalIdentifiers {
  /** Normalized: lowercase, bare (no https://doi.org/ prefix). See §11.1. */
  doi?: string;
  pmid?: string;
  /** With the 'PMC' prefix, e.g. 'PMC10949956'. */
  pmcid?: string;
  /** Bare, version-stripped, e.g. '2106.15928'. */
  arxivId?: string;
  /** Version suffix if the source supplied one, e.g. 'v1'. */
  arxivVersion?: string;
  /** Semantic Scholar SHA. */
  s2PaperId?: string;
  s2CorpusId?: number;
  /** OpenAlex short id, e.g. 'W4380563796'. */
  openAlexId?: string;
  /** Europe PMC id + source, e.g. { id: 'PPR1302423', source: 'PPR' }. */
  epmc?: { id: string; source: string };
  mag?: string;
  acl?: string;
  isbn?: string;
}

export interface CanonicalVenue {
  /** Journal / proceedings / repository name. */
  name?: string;
  /** ISO4 or MEDLINE abbreviation. */
  abbreviation?: string;
  issn?: string[];
  /** Preprint server name for type === 'preprint'. */
  repository?: string;
  publisher?: string;
  /** Conference name for type === 'conferencePaper'. */
  conferenceName?: string;
}

export interface CanonicalDates {
  /** Best available ISO 8601 date, 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. Always set if any date known. */
  issued?: string;
  /** Online-first / e-pub date when distinct from `issued`. */
  onlineFirst?: string;
  /** When the record entered the source index. Used for recency scoring. */
  indexed?: string;
  /** Convenience: integer year parsed from `issued`. */
  year?: number;
}

export interface CanonicalMetrics {
  citationCount?: number;
  referenceCount?: number;
  /** Semantic Scholar only. */
  influentialCitationCount?: number;
}

export interface CanonicalOpenAccess {
  isOpenAccess?: boolean;
  pdfUrl?: string;
  /** 'GOLD' | 'GREEN' | 'HYBRID' | 'BRONZE' | 'CLOSED' */
  status?: string;
  /** Licence string as given by the source, e.g. 'cc_by', 'CCBYNCND'. */
  license?: string;
  /** Verbatim rights/disclaimer text to preserve. */
  rightsNotice?: string;
}

export interface CanonicalRecord {
  /** Stable local key: first available of doi → pmid → arxivId → s2PaperId → hash(title+year). */
  key: string;
  type: WorkType;

  title: string;
  /** Plain text, markup stripped, whitespace normalized. null when the source has none. */
  abstract: string | null;
  /** Machine summary (currently only Semantic Scholar `tldr`). */
  tldr?: string;

  authors: CanonicalAuthor[];
  ids: CanonicalIdentifiers;
  venue: CanonicalVenue;
  dates: CanonicalDates;
  metrics: CanonicalMetrics;
  openAccess: CanonicalOpenAccess;

  volume?: string;
  issue?: string;
  pages?: string;
  language?: string;
  /** Canonical landing URL (prefer https://doi.org/<doi>). */
  url?: string;

  /** Author keywords. */
  keywords: string[];
  /** MeSH descriptors — PubMed/Europe PMC only. */
  meshTerms: { descriptorUi?: string; descriptor: string; major: boolean; qualifiers?: string[] }[];
  /** Source-native subject/field labels (S2 fieldsOfStudy, bioRxiv category, arXiv categories). */
  subjects: string[];
  /** Source-native publication types. */
  publicationTypes: string[];

  /** Provenance. */
  sources: SourceId[];
  /** Per-source raw payloads, kept for debugging and re-derivation. Not persisted to Zotero. */
  raw?: Partial<Record<SourceId, unknown>>;
  /** Set on preprints known to have a published version, and vice versa. See §11.4. */
  linkedVersion?: { role: 'preprint-of' | 'published-version-of'; doi?: string; title?: string };
  /** SPECTER2 vector when fetched. 768 floats. */
  embedding?: { model: string; vector: number[] };
  /** Populated by the retrieval pipeline, not by adapters. */
  retrieval?: { queryId: string; rank: number; sourceScore?: number };
}
```

### 10.2 API response → canonical mapping

| Canonical | PubMed (efetch XML) | Europe PMC (`core`) | Crossref | Semantic Scholar | arXiv (Atom) | bioRxiv `/details/` | OpenAlex |
|---|---|---|---|---|---|---|---|
| `title` | `Article/ArticleTitle` | `title` | `title[0]` | `title` | `entry/title` | `title` | `title` |
| `abstract` | `Abstract/AbstractText[]` (join labels) | `abstractText` | `abstract` (JATS→text) | `abstract` | `entry/summary` | `abstract` | `abstract_inverted_index` (reconstruct) |
| `tldr` | — | — | — | `tldr.text` | — | — | — |
| `authors[].lastName` | `Author/LastName` | `authorList.author[].lastName` | `author[].family` | split from `authors[].name` | split from `author/name` | split from `authors` (`"Last, F.; …"`) | split from `authorships[].author.display_name` |
| `authors[].firstName` | `Author/ForeName` | `.firstName` | `author[].given` | ″ | ″ | ″ | ″ |
| `authors[].orcid` | `Author/Identifier[@Source='ORCID']` | `.authorId` (ORCID type) | `author[].ORCID` | — | — | — | `authorships[].author.orcid` |
| `authors[].affiliations` | `AffiliationInfo/Affiliation` | `authorAffiliationDetailsList` | `author[].affiliation[].name` | — | — | `author_corresponding_institution` (corr. only) | `authorships[].raw_affiliation_strings` |
| `ids.doi` | `ArticleId[@IdType='doi']` | `doi` | `DOI` | `externalIds.DOI` | `arxiv:doi` (published) or `10.48550/arXiv.<id>` | `doi` | `doi` (strip URL) |
| `ids.pmid` | `PMID` | `pmid` | — | `externalIds.PubMed` | — | — | `ids.pmid` (strip URL) |
| `ids.pmcid` | `ArticleId[@IdType='pmc']` | `pmcid` | — | `externalIds.PubMedCentral` (add `PMC`) | — | — | `ids.pmcid` |
| `ids.arxivId` | — | — | — | `externalIds.ArXiv` | parse `entry/id` | — | — |
| `ids.s2PaperId` | — | — | — | `paperId` | — | — | — |
| `ids.epmc` | — | `{id, source}` | — | — | — | — | — |
| `venue.name` | `Journal/Title` | `journalInfo.journal.title` | `container-title[0]` | `journal.name` ‖ `venue` | — | — | `primary_location.source.display_name` |
| `venue.abbreviation` | `Journal/ISOAbbreviation` | `.medlineAbbreviation` | `short-container-title[0]` | — | — | — | — |
| `venue.issn` | `Journal/ISSN` | `.issn`, `.essn` | `ISSN[]` | — | — | — | `primary_location.source.issn` |
| `venue.repository` | — | `bookOrReportDetails.publisher` | `institution[].name` | `venue` (= "bioRxiv") | `"arXiv"` | `server` | `primary_location.source.display_name` |
| `dates.issued` | `PubMedPubDate[@PubStatus='pubmed']` → `ArticleDate` → `JournalIssue/PubDate` | `firstPublicationDate` ‖ `journalInfo.printPublicationDate` | `issued.date-parts` | `publicationDate` ‖ `year` | `entry/published` | `date` | `publication_date` |
| `dates.indexed` | `PubMedPubDate[@PubStatus='entrez']` | `firstIndexDate` | `indexed.date-time` | — | — | — | `updated_date` |
| `metrics.citationCount` | — | `citedByCount` | `is-referenced-by-count` | `citationCount` | — | — | `cited_by_count` |
| `metrics.referenceCount` | — | — | `reference-count` | `referenceCount` | — | — | `referenced_works_count` |
| `metrics.influentialCitationCount` | — | — | — | `influentialCitationCount` | — | — | — |
| `volume` / `issue` / `pages` | `JournalIssue/Volume`, `/Issue`, `Pagination/MedlinePgn` | `journalInfo.volume`, `.issue`, `pageInfo` | `volume`, `issue`, `page` | `journal.volume`, `journal.pages` | — | — | `biblio.volume`, `.issue`, `.first_page`-`.last_page` |
| `language` | `Language` | `language` | `language` | — | `"en"` | — | `language` |
| `keywords` | `KeywordList/Keyword` | `keywordList.keyword` | — | — | — | — | `keywords[].display_name` |
| `meshTerms` | `MeshHeadingList` | `meshHeadingList` | — | — | — | — | `mesh[]` |
| `subjects` | `PublicationTypeList` | `pubTypeList` | `subject[]` | `fieldsOfStudy`, `s2FieldsOfStudy` | `category[@term]` | `category` | `topics[].display_name` |
| `openAccess.pdfUrl` | — | `fullTextUrlList` (availabilityCode `F`) | `link[].URL` (`application/pdf`) | `openAccessPdf.url` | `link[@title='pdf']` | construct from `jatsxml` | `best_oa_location.pdf_url` |
| `openAccess.license` | — | `license` | `license[].URL` | `openAccessPdf.license` | — | `license` | `best_oa_location.license` |
| `openAccess.rightsNotice` | `Abstract/CopyrightInformation` | — | — | `openAccessPdf.disclaimer` | — | — | — |
| `type` | `PublicationTypeList` → map | `pubType` / `source == 'PPR'` | `type` → map | `publicationTypes` → map | always `preprint` | always `preprint` | `type` → map |

**`type` mapping rules:**

| Canonical | Triggers |
|---|---|
| `preprint` | EPMC `source == 'PPR'`; Crossref `type == 'posted-content'`; any arXiv or bioRxiv record; S2 `venue` ∈ {bioRxiv, medRxiv, arXiv, Research Square, SSRN}; OpenAlex `type == 'preprint'` |
| `conferencePaper` | Crossref `type == 'proceedings-article'`; S2 `publicationTypes` includes `Conference`; OpenAlex `type == 'proceedings-article'` |
| `bookSection` | Crossref `book-chapter`; S2 `BookSection` |
| `journalArticle` | default when a venue with an ISSN exists |
| `other` | everything else — datasets, editorials without a venue |

### 10.3 Canonical → Zotero item fields

Verified against **Zotero schema version 42** (`itemTypes` definitions read directly from the
bundled schema).

**Important, and easy to get wrong:** `journalArticle` has **native `PMID` and `PMCID` fields** in
schema 42 — the old `Extra: PMID: …` convention is no longer needed for journal articles. But
`preprint` has **neither**, and **no `ISSN`**; and **no** item type has a native arXiv-ID field
(use `archiveID`).

#### `journalArticle`

Available fields: `title`, `abstractNote`, `publicationTitle`, `publisher`, `place`, `date`,
`volume`, `issue`, `section`, `partNumber`, `partTitle`, `pages`, `series`, `seriesTitle`,
`seriesText`, `journalAbbreviation`, `DOI`, `citationKey`, `url`, `accessDate`, **`PMID`**,
**`PMCID`**, `ISSN`, `archive`, `archiveLocation`, `shortTitle`, `language`, `libraryCatalog`,
`callNumber`, `rights`, `extra`. Creators: `author` (primary), `contributor`, `editor`,
`translator`, `reviewedAuthor`.

| Canonical | Zotero field |
|---|---|
| `title` | `title` |
| `abstract` | `abstractNote` |
| `authors[]` | creators, `creatorType: 'author'` (`firstName`/`lastName`; `fieldMode: 1` + `lastName` only when `isInstitutional`) |
| `venue.name` | `publicationTitle` |
| `venue.abbreviation` | `journalAbbreviation` |
| `venue.issn[0]` | `ISSN` |
| `dates.issued` | `date` |
| `volume` / `issue` / `pages` | `volume` / `issue` / `pages` |
| `ids.doi` | `DOI` |
| `ids.pmid` | **`PMID`** |
| `ids.pmcid` | **`PMCID`** |
| `language` | `language` |
| `url` | `url` |
| `openAccess.license` + `rightsNotice` | `rights` |
| — | `libraryCatalog` = source label, e.g. `"Europe PMC"` |
| — | `accessDate` = retrieval timestamp |
| `keywords` + `meshTerms` | Zotero **tags** (see below) |
| leftovers | `extra` (see below) |

#### `preprint`

Available fields: `title`, `abstractNote`, `genre` (base `type`), `repository` (base `publisher`),
`archiveID` (base `number`), `place`, `date`, `series`, `seriesNumber`, `DOI`, `citationKey`, `url`,
`accessDate`, `archive`, `archiveLocation`, `shortTitle`, `language`, `libraryCatalog`,
`callNumber`, `rights`, `extra`.

| Canonical | Zotero field |
|---|---|
| `venue.repository` | **`repository`** (`"bioRxiv"`, `"arXiv"`, `"medRxiv"`) |
| `ids.arxivId` | **`archiveID`** — store as `"arXiv:2106.15928"` |
| `ids.doi` | `DOI` |
| `publicationTypes[0]` | `genre` (e.g. `"Preprint"`) |
| `ids.pmid` / `ids.pmcid` | **no native field → `extra`** |
| everything else | as `journalArticle` |

#### `conferencePaper`

Available fields include `proceedingsTitle` (base `publicationTitle`), `conferenceName`,
`publisher`, `place`, `eventPlace`, `volume`, `issue`, `numberOfVolumes`, `pages`, `series`,
`seriesNumber`, `DOI`, `ISBN`, `ISSN`, plus the common set. **No `PMID`/`PMCID`.**

| Canonical | Zotero field |
|---|---|
| `venue.name` | `proceedingsTitle` |
| `venue.conferenceName` | `conferenceName` |
| `venue.publisher` | `publisher` |
| `ids.pmid` / `ids.pmcid` | `extra` |

#### `extra` field convention

Zotero's citation processor recognises `Key: value` lines in `extra`. Emit only what has no native
home, one per line, stable order:

```
PMID: 37258680
PMCID: PMC10949956
arXiv: 2106.15928
Semantic Scholar: 7d1e59ce254bea5228da634dbe7c5c4160df6f98
Citations: 1220
tldr: A context-aware, attention-based deep learning model ...
rh-sources: europepmc,semanticscholar
rh-work-key: doi:10.1038/s41586-023-06139-9
```

The last two lines are the plugin's own provenance markers and are what feature 6 reads to answer
"is this already in the library?" without a full re-match.

> **The plugin's `extra` prefix is `rh-`, and `07-architecture-and-data-model.md` §6.3 owns it** —
> along with the read/write rules (parse to `(key, value, lineIndex)` triples, replace only our own
> lines, preserve foreign lines byte-for-byte, cap total growth). The key is `rh-work-key` and its
> value is the prefixed `CanonicalWork.workKey` (doc 07 §5.1: `doi:<doi>`, `pmid:<pmid>`, …), not a
> bare DOI. An earlier draft of this section wrote these two lines as `research_helper-sources:` and
> `research_helper-key:`; both spellings are gone, because two prefixes over one field is how an
> import written by one release becomes invisible to the next. The `PMID:` / `PMCID:` /
> `arXiv:` / `Citation Key:` lines above are the non-namespaced ecosystem conventions and are
> written **only** where the item type has no native field for them (doc 07 §6.3).

#### Tags

- MeSH descriptors → tags, type 1 (automatic). Prefix major topics: `MeSH: Machine Learning` vs.
  `MeSH*: Machine Learning`.
- Author keywords → tags, type 1, unprefixed.
- arXiv categories → `arXiv: q-bio.GN`.
- Add one provenance tag per run: `research_helper` so users can find and bulk-remove imports.

Automatic (type 1) tags are the right choice: Zotero visually distinguishes them from user tags and
they can be cleared en masse.

### 10.4 Field-level merge and backfill

**This table is the corpus's single source of per-field source precedence.** §11.5 states it
normatively ("field precedence is the table in §10.4"), and
`07-architecture-and-data-model.md` §5.1 defers to it rather than restating it — an earlier draft of
that section carried a second, different ordering for `title`. Precedence ships as one exported
constant in `src/model/merge.ts` (doc 07 §5.1) so it is tunable and unit-testable in one place.
**OpenAlex appears in four of the orderings below and is inert in v1** — no adapter ships (§9.3), so
no record ever carries that source and the remaining sources keep their relative order; the entries
are left in place because they are the ordering a v1.1 adoption would need.

> **Measured 2026-09-15 (`P0-T21`) — incidental overlap is near zero; backfill must be targeted.** Of 287 DOIs across the PubMed, Europe PMC and Crossref top-100 lists for one query, only **9** appeared in two sources, so merging overlapping results recovers almost nothing. A targeted Europe PMC DOI lookup (step 1 below) lifted Crossref-sourced records from **41 % to 62 %**; PubMed and Europe PMC could not backfill each other at all (0 in both directions — they share MEDLINE). Step 2 (Semantic Scholar) was unmeasurable without a key, so **~62 % is the realistic keyless ceiling** for Crossref-sourced abstracts on that query.

When the same work is seen by several sources (§11), build the canonical record field-by-field with
explicit precedence rather than "first source wins":

| Field | Precedence (best first) | Why |
|---|---|---|
| `title` | Crossref → PubMed → Europe PMC → OpenAlex → S2 → arXiv | Publisher-deposited; PubMed appends a trailing `.` to strip |
| `abstract` | Europe PMC → PubMed → S2 → Crossref (JATS) → arXiv → bioRxiv → OpenAlex | Ordered by fidelity; OpenAlex last (reconstructed) |
| `authors` | PubMed → Europe PMC → Crossref → OpenAlex → arXiv → S2 | S2 abbreviates given names |
| `dates.issued` | Europe PMC `firstPublicationDate` → PubMed `pubmed` history date → Crossref `issued` → S2 → OpenAlex | Crossref cover dates can lead reality |
| `venue.*` | Crossref → PubMed → Europe PMC → OpenAlex → S2 | |
| `ids.*` | union of all, per §11 normalization | never overwrite a present ID with a conflicting one — flag instead |
| `metrics.citationCount` | S2 → OpenAlex → Crossref → Europe PMC | S2 and OpenAlex count preprints; Crossref counts only Crossref-deposited references |
| `meshTerms` | PubMed → Europe PMC | only these two have MeSH |
| `tldr` | S2 only | |
| `openAccess` | S2 `openAccessPdf` → OpenAlex `best_oa_location` → Europe PMC `fullTextUrlList` | |

**Backfill pass.** After dedup, any record still missing an abstract gets one targeted lookup, in
this order, stopping at the first hit:

1. Europe PMC `search?query=DOI:"<doi>"&resultType=core` — free, fast, no key.
2. Semantic Scholar `/paper/batch` with `fields=abstract,tldr` — 100 DOIs per call, but 1 req/s.
3. Crossref `/works/{doi}?select=abstract` — JATS, low hit rate.

Batch these: never issue one lookup per record. A 200-record collection needs **2 Europe PMC calls
and 2 S2 calls**, not 400 requests.

---

## 11. Deduplication

Deduplication runs at two moments: **within a result set** (merging the same paper found by five
sources) and **against the user's existing Zotero library** (feature 6's "don't recommend what I
already have").

### 11.1 DOI normalization

DOIs are the strongest signal, but every source formats them differently.

```ts
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).trim();
  // Strip resolver prefixes and the doi: scheme (OpenAlex sends full URLs).
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
       .replace(/^doi:\s*/i, '')
       .replace(/^info:doi\//i, '');
  // Strip surrounding angle brackets / quotes seen in some deposits.
  d = d.replace(/^[<"']+|[>"']+$/g, '');
  // Trailing punctuation from text extraction.
  d = d.replace(/[.,;)\]]+$/, '');
  // DOIs are case-insensitive; lowercase for comparison.
  d = d.toLowerCase();
  // Percent-decode once (some sources over-encode the suffix).
  try { if (/%[0-9a-f]{2}/i.test(d)) d = decodeURIComponent(d); } catch { /* keep as-is */ }
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : null;
}
```

**Real cases this handles**, all observed in this project's live probes:
- OpenAlex returns `"https://doi.org/10.1056/nejmoa2300709"` — prefix and already lowercase.
- Semantic Scholar returns `"10.18653/V1/2020.ACL-MAIN.447"` — **uppercase suffix**, which would not
  match Crossref's `10.18653/v1/2020.acl-main.447` without lowercasing.
- Crossref returns `"10.3791\/20970"` — JSON-escaped slash (handled by the JSON parser, not here).

**Caution:** lowercasing is correct for *matching*, but a handful of publishers mint
case-sensitive-looking DOIs, so a lowercased DOI will not always be byte-identical to the string
the publisher advertises.

**This does not mean the plugin keeps a second spelling. `normalizeDoi()`'s lowercase output is the
only DOI the plugin stores, displays, or writes to Zotero.** An earlier draft of this paragraph told
the implementer to "store the first-seen original form for display and writing to Zotero"; that is
withdrawn, because there is nowhere to put it and three documents already require the opposite:

- `07-architecture-and-data-model.md` §5.1 brands `Doi` as the lowercase normalized form and gives
  `ExternalIds` **no** field for a second spelling;
- `07-architecture-and-data-model.md` §6.2 maps `ids.doi` straight into Zotero's `DOI` field;
- `10-requirements-and-user-stories.md` **FR-6** requires the stored DOI be lowercase.

The reasons the normalized form wins, and they are the same three reasons in every case: it is what
deduplication keys on (§11.3's cascade compares normalized DOIs; two spellings of one DOI would
match neither each other nor a third source), it is what the cache keys on
(`07-architecture-and-data-model.md` §9 — a case-variant key is a cache miss and a duplicate fetch),
and it is what the `rh-work-key` written into Zotero's `extra` field derives from when no key is
present (`07-architecture-and-data-model.md` §6.6, "a key is derived from DOI → PMID → arXiv →
title hash"), so a re-read of an item must reproduce the same string an earlier write derived its
key from. Against that, the cost of lowercasing is cosmetic only: **DOIs are
case-insensitive for resolution** — `https://doi.org/10.18653/V1/…` and
`https://doi.org/10.18653/v1/…` resolve to the same record — so Zotero's own `DOI` field, and any
link built from it, works identically with the lowercase form.

Use the normalized form as the dictionary key *and* as the stored value. If a DOI must ever be
shown in the publisher's own casing, fetch it from the live source record at display time; do not
persist a second copy.

### 11.2 The bioRxiv DOI prefix change (verified, and it will break naive matchers)

**New finding, 2026-09-08:** bioRxiv/medRxiv preprints are now minted under the DOI prefix
**`10.64898/`**, not the historical **`10.1101/`**. Both are live simultaneously:

- New: `10.64898/2026.08.20.745440`, `10.64898/2026.07.31.741992` (Europe PMC, bioRxiv API,
  Semantic Scholar all agree)
- Legacy: `10.1101/2025.09.17.676679` (returned by bioRxiv `/pubs/` for a 2025 preprint)

**Implications:**
1. Any code that detects preprints by testing `doi.startsWith('10.1101/')` is now wrong. Test
   against a set: `['10.1101/', '10.64898/', '10.48550/', '10.21203/', '10.2139/']`
   (bioRxiv-legacy, bioRxiv/medRxiv-current, arXiv, Research Square, SSRN).
2. The **suffix** (`2026.08.20.745440`) is the stable bioRxiv accession across both prefixes.
   Matching on suffix alone is a useful secondary key.

**medRxiv uses `10.64898/` too — verified 2026-09-09.** A Europe PMC query for
`(SRC:PPR) AND (PUBLISHER:"medRxiv") AND (FIRST_PDATE:[2026-06-01 TO 2026-09-08])` (hitCount 4,657)
returned records such as `10.64898/2026.09.03.26361736` and `10.64898/2026.09.02.26361916`, all with
`bookOrReportDetails.publisher == "medRxiv"`. **The prefix therefore does not distinguish bioRxiv
from medRxiv** — use the publisher/server field, never the DOI prefix, for server detection.

> **Unverified:** whether legacy `10.1101/` DOIs are being re-minted under the new prefix. Both
> prefixes were observed live in the same `/details/` page (`10.64898/2026.07.31.741992` alongside
> `10.1101/2025.04.11.648403`), which is consistent with "new prefix from a cutover date, legacy
> DOIs left alone" — but that was not confirmed against a bioRxiv announcement.

### 11.3 The matching cascade

Run in order; stop at the first confident match. Each tier is cheaper and more certain than the next.

```
Tier 0  Exact normalized DOI                        → MATCH (confidence 1.00)
Tier 1  Exact PMID                                  → MATCH (1.00)
Tier 2  Exact PMCID                                 → MATCH (1.00)
Tier 3  Exact arXiv ID (version-stripped)           → MATCH (0.99)
Tier 4  Exact S2 paperId / CorpusId                 → MATCH (0.99)
Tier 5  Normalized title exact + |Δyear| ≤ 1        → MATCH (0.95)
Tier 6  Fuzzy title ≥ threshold + author + year     → MATCH (0.80–0.94), see §11.3.3
Tier 7  Known preprint↔published link               → LINK, not merge (§11.4)
        otherwise                                    → DISTINCT
```

#### 11.3.1 ID normalization

```ts
const normPmid  = (s: string) => s.trim().replace(/^PMID:?\s*/i, '').replace(/\D/g, '') || null;
const normPmcid = (s: string) => {
  const n = s.trim().replace(/^PMCID:?\s*/i, '').replace(/^PMC/i, '').replace(/\D/g, '');
  return n ? `PMC${n}` : null;                       // S2 returns '10949956' bare; PubMed 'PMC10949956'
};
const normArxiv = (s: string) => {
  let a = s.trim().replace(/^ar[xX]iv:/i, '')
                  .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '')
                  .replace(/\.pdf$/i, '');
  a = a.replace(/v\d+$/i, '');                       // strip version for matching
  // new-style 2106.15928, old-style math.GT/0309136
  return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/.test(a) ? a : null;
};
```
The `normPmcid` case is real: Semantic Scholar returns `"PubMedCentral": "10949956"` while PubMed
returns `PMC10949956` for the same paper.

#### 11.3.2 Title normalization

```ts
export function normalizeTitle(t: string): string {
  return t
    .normalize('NFKD')                          // decompose accents
    .replace(/[̀-ͯ]/g, '')            // drop combining marks
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')                   // JATS/HTML tags from Crossref & PubMed
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')  // entities
    .replace(/[‐-―−]/g, '-')     // unicode dashes → hyphen
    .replace(/[‘’“”]/g, "'")// smart quotes
    .replace(/[^a-z0-9]+/g, ' ')                // all punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');                        // PubMed's trailing period
}
```
This makes `"Transfer learning enables predictions in network biology."` (PubMed) and
`"Transfer learning enables predictions in network biology"` (Semantic Scholar) identical — a real
case from the probes above.

#### 11.3.3 Fuzzy title matching

Use **both** a character-level and a token-level measure, because they fail differently:

```ts
/** Normalized Levenshtein similarity in [0,1]. Catches typos, OCR noise, missing subtitles. */
function levSim(a: string, b: string): number {
  const d = levenshtein(a, b);                       // standard DP, O(|a|·|b|)
  return 1 - d / Math.max(a.length, b.length);
}

/** Jaccard over word tokens. Catches reordering and word-level insertions. */
function jaccard(a: string, b: string): number {
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
```

**Cheap blocking first** — never run O(n²) Levenshtein over a whole library. Bucket candidates by
(a) publication year ±1 and (b) a 3-token signature of the longest words in the title. Only compare
within a bucket.

**Thresholds** (tune against a real user library before shipping):

| Condition | Verdict |
|---|---|
| `levSim ≥ 0.95` **and** `\|Δyear\| ≤ 1` | duplicate |
| `levSim ≥ 0.88` **and** `jaccard ≥ 0.80` **and** first-author family name matches **and** `\|Δyear\| ≤ 1` | duplicate |
| `jaccard ≥ 0.90` **and** first-author matches **and** same year | duplicate (word reordering) |
| `levSim ≥ 0.80` and nothing else corroborates | **flag for user review, do not auto-merge** |
| otherwise | distinct |

**Guards against known false-positive families:**
- Titles under 5 normalized tokens (`"Retraction"`, `"Editorial"`, `"Correction"`) — require an
  exact ID match, never fuzzy-merge these.
- Series titles differing only by a roman numeral or trailing digit (`"… Part II"` vs `"… Part
  III"`) — Levenshtein rates these ~0.97. Detect a trailing
  `/\b(part\s+)?([ivxlc]+|\d+)$/` difference and force *distinct*.
- Same title, different year, different journal → almost always a conference paper later extended
  into a journal article. Link, don't merge.

### 11.4 Preprint ↔ published-version linking

These are **different works** with different DOIs, and a user may legitimately want both. **Link
them; do not silently merge.** The default UI behaviour should be: keep the published version,
suppress the preprint from results, and record the link — with a preference to keep both.

Detection signals, in confidence order:

| Signal | Source | Confidence |
|---|---|---|
| `published_doi` present | bioRxiv `/pubs/` or `/details/` (`published` field ≠ `"NA"`) | 1.00 |
| `relation.is-preprint-of` / `is-published-in` | Crossref work record | 1.00 |
| `<arxiv:doi>` present in an arXiv entry | arXiv Atom | 1.00 — the element carries the *journal* DOI |
| `<arxiv:journal_ref>` present | arXiv Atom | 0.90 — text only, must be resolved |
| Same S2 `paperId` for both DOIs | Semantic Scholar clusters versions | 0.95 |
| OpenAlex `locations[]` containing both a preprint and a journal location | OpenAlex | 0.90 |
| Fuzzy title match, one is `type: 'preprint'`, published year ≥ preprint year | derived | 0.75 → flag |

```ts
function linkVersions(a: CanonicalRecord, b: CanonicalRecord) {
  const [pre, pub] = a.type === 'preprint' ? [a, b] : [b, a];
  pre.linkedVersion = { role: 'preprint-of', doi: pub.ids.doi, title: pub.title };
  pub.linkedVersion = { role: 'published-version-of', doi: pre.ids.doi, title: pre.title };
}
```

In Zotero, record the link with a **related item** relation (`dc:relation`) when both are imported,
and add `Preprint DOI: <doi>` / `Published DOI: <doi>` to `extra` when only one is.

### 11.5 Merge precedence and conflict handling

Field precedence is the table in §10.4. Two additional rules:

1. **IDs are unioned, never overwritten.** If two records claim conflicting DOIs but matched on
   title, that is *evidence they are not duplicates* (most likely preprint vs published). Downgrade
   to a link and log it.
2. **`sources` accumulates**, and every merge records which source supplied each field in
   `raw`. This makes the "why did the plugin pick this title?" question answerable, which matters
   when a user reports a bad import.

```ts
interface IdConflict { field: string; values: unknown[] }

/** PRECEDENCE_ORDER lists the CanonicalRecord fields resolved by the §10.4 precedence table. */
declare const PRECEDENCE_ORDER: readonly (keyof CanonicalRecord)[];
declare function pickByPrecedence<K extends keyof CanonicalRecord>(
  records: CanonicalRecord[], field: K): CanonicalRecord[K];

function merge(records: CanonicalRecord[]): { merged: CanonicalRecord; conflicts: IdConflict[] } {
  const conflicts: IdConflict[] = [];
  const out = { ...records[0], sources: [], ids: {}, raw: {} } as CanonicalRecord;
  out.sources = [...new Set(records.flatMap(r => r.sources))];
  for (const r of records) {
    for (const [k, v] of Object.entries(r.ids)) {
      if (v == null) continue;
      const existing = (out.ids as any)[k];
      if (existing == null) (out.ids as any)[k] = v;
      else if (existing !== v) conflicts.push({ field: `ids.${k}`, values: [existing, v] });
    }
    Object.assign(out.raw!, r.raw);
  }
  for (const field of PRECEDENCE_ORDER) {
    (out as Record<string, unknown>)[field] = pickByPrecedence(records, field);
  }
  out.key = out.ids.doi ?? out.ids.pmid ?? out.ids.arxivId ?? out.ids.s2PaperId ?? hashTitleYear(out);
  return { merged: out, conflicts };
}
```

### 11.6 Matching against the existing Zotero library

For feature 6 the plugin must exclude papers the user already has. Build the index once per run:

```ts
// Read once; Zotero.Search over the whole library is far cheaper than per-candidate lookups.
const index = {
  byDoi:   new Map<string, number>(),   // normalized DOI  → itemID
  byPmid:  new Map<string, number>(),
  byArxiv: new Map<string, number>(),
  byTitle: new Map<string, number[]>(), // normalized title → itemIDs (bucket)
};
```

Populate from `item.getField('DOI')`, `item.getField('PMID')` (native in schema 42),
`item.getField('archiveID')`, and `extra` lines. Then each candidate costs O(1) lookups plus a
fuzzy pass only within its title bucket.

**Also index attachments and the trash?** No — check `item.deleted` and skip trashed items, so a
paper the user deliberately deleted can be re-recommended (or, better, add it to a persistent
"dismissed" list; see doc 05).

---

## 12. Query translation

The user types **one string** into one box. The plugin must render it into six different query
languages without the user knowing.

### 12.1 The intermediate representation

Parse the user's input into a small AST rather than doing string surgery per adapter.

> **Authority note.** `07-architecture-and-data-model.md` §4.2 owns the *shipped* `QueryNode` and
> `QueryField` — the ones `src/sources/types.ts` declares, carried on `SourceQuery.terms`. There the
> discriminant is `kind` with the lowercase members `"term" | "and" | "or" | "not"`, the term node's
> text is `value`, and `QueryField` is `"title" | "abstract" | "titleOrAbstract" | "author" |
> "journal" | "affiliation" | "meshTerm" | "any"`. The sketch below predates that consolidation and
> uses shorter working names (`op`/`text`, `titleAbstract`, `venue`, `all`). Its `ParsedQuery`
> wrapper carries the parsed tree plus the date window; doc 07 §4.2's `SourceQuery` is what the
> adapters actually receive, and adds the paging, language and open-access fields that this sketch
> does not model. `ParsedQuery` is not a second declaration — no other document declares that name —
> but it is not the shipped request object either. Read the block for **what the AST has to be able
> to express and how each database renders it** — that is what this section owns, and §12.2 is its
> point. Take the exact names from doc 07 §4.2 when writing code; where the two disagree, doc 07
> wins and this is the defect. Do not declare a second `QueryNode` or `QueryField`.

```ts
type QueryNode =
  | { op: 'AND' | 'OR'; children: QueryNode[] }
  | { op: 'NOT'; child: QueryNode }
  | { op: 'TERM'; text: string; field?: QueryField; phrase: boolean };

type QueryField = 'title' | 'abstract' | 'titleAbstract' | 'author' | 'venue' | 'all';

interface ParsedQuery {
  root: QueryNode;
  /** Applied by every adapter in its own syntax. */
  dateFrom: string;   // 'YYYY-MM-DD'
  dateTo: string;
  types?: WorkType[];
}
```

Accept a deliberately small user syntax — quotes for phrases, `AND`/`OR`/`NOT` (and `-` for NOT),
parentheses, and `field:` prefixes (`title:`, `abstract:`, `author:`, `journal:`). Bare
space-separated words default to AND. Anything unparseable falls back to a single
`{op:'TERM', field:'all'}` node containing the raw string — **never** show a syntax error for a
natural-language query.

### 12.2 Per-source rendering

For the example query `("base editing" OR "prime editing") AND title:CRISPR NOT mouse`,
default three-calendar-year window `2024-01-01 … 2026-12-31` (`08-ui-ux-spec.md` §4.2 owns the
computation; FR-3 requires calendar years, not a rolling 36 months):

#### PubMed
```
term=(("base editing"[All Fields] OR "prime editing"[All Fields])
      AND CRISPR[Title]
      NOT mouse[All Fields])
      AND ("2024/01/01"[EDAT] : "2026/12/31"[EDAT])
```
Field tags: `[Title]`, `[Title/Abstract]`, `[Author]`, `[Journal]`, `[MeSH Terms]`, `[All Fields]`.
Booleans **must be uppercase**. Date via `[EDAT]`/`[PDAT]` range or the `mindate`/`maxdate` params.

#### Europe PMC
```
query=(("base editing" OR "prime editing") AND TITLE:"CRISPR" NOT "mouse")
      AND (FIRST_PDATE:[2024-01-01 TO 2026-12-31])
```
Field prefixes per §4.3. **Keep the rendered query under ~1500 characters as a design budget** (the
figure Europe PMC's own error text names, though it is not enforced there — §4.1); above it switch
to `searchPOST` to stay clear of the URI-length ceiling, and if the query is still unwieldy, split
into an OR-fan of sub-queries and merge client-side.

#### Crossref
Crossref has **no Boolean operator support** in `query.*`. Terms are scored, not filtered.
```
query.bibliographic=base editing prime editing CRISPR
&query.title=CRISPR
&filter=from-pub-date:2024-01-01,until-pub-date:2026-12-31,type:journal-article
```
Strategy: flatten OR-groups into the bag of words, promote `title:` terms into `query.title`, and
**drop NOT clauses entirely — then filter the results client-side** against the NOT terms. Document
this lossiness in the UI (a "Crossref results are approximate" note), because it is the only source
where the user's Boolean intent is not honoured.

#### Semantic Scholar
Two different renderings for two endpoints:
```
# /paper/search  — plain text only, no operators
query=base editing prime editing CRISPR
&year=2024-2026
&publicationDateOrYear=2024-01-01:2026-12-31

# /paper/search/bulk — real operators
query=("base editing" | "prime editing") + CRISPR - mouse
&publicationDateOrYear=2024-01-01:2026-12-31
```
Mapping: `AND`→`+`, `OR`→`|`, `NOT`→`-`, phrases keep quotes, groups keep parentheses.
**Remove hyphens from terms** — the spec warns "hyphenated query terms yield no matches." Replace
`-` inside a term with a space *before* using `-` as the NOT operator, or the two collide.
There is no field-specific syntax; `title:` prefixes are dropped.

#### arXiv
```
search_query=%28abs:%22base+editing%22+OR+abs:%22prime+editing%22%29
             +AND+ti:CRISPR
             +ANDNOT+all:mouse
             +AND+submittedDate:%5B202401010000+TO+202612312359%5D
```
`NOT` → **`ANDNOT`** (arXiv has no bare `NOT`). Encode `(`→`%28`, `)`→`%29`, `"`→`%22`,
`[`→`%5B`, `]`→`%5D`, spaces→`+`. If the user's query has no obvious physics/CS relevance, consider
skipping arXiv entirely rather than spending a 3-second slot on it.

#### OpenAlex (v1.1 research — no query is emitted in v1, §9.3)
```
filter=title_and_abstract.search:base editing|prime editing,
       title.search:CRISPR,
       from_publication_date:2024-01-01,
       to_publication_date:2026-12-31
```
`|` is OR within a filter value; `!` prefixes negation (`title.search:!mouse`); commas AND filters
together. Note `search` filters cost **$0.001** each versus `$0.0001` for plain filters — one more
reason OpenAlex is out of v1 (§9.3).

#### bioRxiv
**Not applicable** — no keyword search (§8.4). The translator should not emit a bioRxiv query at
all; route preprint search to Europe PMC `SRC:PPR`.

### 12.3 Summary translation table

| Concept | PubMed | Europe PMC | Crossref | S2 bulk | arXiv | OpenAlex |
|---|---|---|---|---|---|---|
| AND | `AND` | `AND` | *implicit, scored* | `+` | `AND` | `,` between filters |
| OR | `OR` | `OR` | *n/a* | `\|` | `OR` | `\|` in a value |
| NOT | `NOT` | `NOT` | *client-side* | `-` | `ANDNOT` | `!` prefix |
| Phrase | `"…"` | `"…"` | *n/a* | `"…"` | `%22…%22` | `"…"` |
| Title field | `[Title]` | `TITLE:` | `query.title` | *n/a* | `ti:` | `title.search:` |
| Abstract | `[Title/Abstract]` | `ABSTRACT:` | *n/a* | *n/a* | `abs:` | `abstract.search:` |
| Author | `[Author]` | `AUTH:` | `query.author` | *n/a* | `au:` | `raw_author_name.search:` |
| Date range | `[EDAT]`/`mindate`+`maxdate` | `FIRST_PDATE:[a TO b]` | `filter=from-pub-date:` | `publicationDateOrYear=a:b` | `submittedDate:[a TO b]` | `from_publication_date:` |
| Pagination | `retstart` (≤9998) | `cursorMark` | `cursor=*` | `token` | `start` | `cursor=*` |

### 12.4 LLM-assisted query expansion (optional feature)

Two free, deterministic expansions come before any LLM call:

1. **PubMed already does it.** The `translationset` / `querytranslation` in every `esearch` response
   shows the MeSH expansion PubMed applied — in the live probe, `"CRISPR"` expanded to include
   `"clustered regularly interspaced short palindromic repeats"[MeSH Terms]`. **Parse
   `translationset` and reuse the discovered MeSH terms in the Europe PMC and Crossref queries**,
   which do not expand automatically. This is free, authoritative, and requires no LLM. Both values
   are also recorded in the run's provenance record, in `SourceProvenance.sourceExtras`
   (`07-architecture-and-data-model.md` §5.3), so a reader can see the expansion that actually ran.
2. **Europe PMC `&synonym=true`** applies its own vocabulary expansion server-side.

Only then reach for the LLM (doc 03 covers provider mechanics). Useful, bounded tasks:

| Task | Prompt shape | Guardrail |
|---|---|---|
| Synonym/acronym expansion | "List 5–8 alternative terms for `<term>` as used in the scientific literature. Return JSON array of strings." | Cap at 8; OR them into the abstract field only, never the title field, or precision collapses |
| MeSH suggestion | "Which MeSH descriptors best cover `<query>`? Return JSON array of exact MeSH headings." | **Validate every returned heading against the live MeSH vocabulary** (E-utilities `esearch&db=mesh`) and silently drop any that doesn't resolve — LLMs hallucinate plausible-looking MeSH terms |
| Field routing | "Which parts of this query are author names, venues, or topics?" | Only used to populate the AST; user can override |
| Natural-language → structured | "Convert this research question into a Boolean query." | **Always show the generated query to the user, editable, before running it** |

**Non-negotiable UX rule:** never silently expand a user's query. Show the expansion, let them
uncheck terms, and remember the choice. An LLM that quietly adds five synonyms turns "I searched for
X" into "the plugin searched for something else" — which destroys trust in the result set and makes
the eventual trend report unreproducible.

**Cost note:** query expansion is one small LLM call per search. That is cheap. Do not expand
per-source (one expansion, rendered into all six syntaxes).

---

## Sources

All URLs retrieved and verified 2026-09-08.

**NCBI / PubMed**
- [Entrez Programming Utilities Help (NBK25501)](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [A General Introduction to the E-utilities — Usage Guidelines and Requirements (NBK25497)](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [The E-utilities In-Depth: Parameters, Syntax and More (NBK25499)](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [NCBI Account / API Key Management](https://www.ncbi.nlm.nih.gov/account/)
- [PMC ID Converter API (new endpoint)](https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/)

**Europe PMC**
- [Europe PMC RESTful Web Service](https://europepmc.org/RestfulWebService)
- [Europe PMC Developer Forum (rate-limit guidance)](https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices)
- [Europe PMC Web Service Reference (PDF)](https://europepmc.org/docs/EBI_Europe_PMC_Web_Service_Reference.pdf)

**Crossref**
- [Crossref REST API Swagger docs](https://api.crossref.org/swagger-docs)
- [Access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)
- [Tips for using the Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)
- [Announcing changes to REST API rate limits (effective 2025-12-01)](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/)
- [Crossref REST API documentation repository](https://github.com/Crossref/rest-api-doc)

**Semantic Scholar**
- [Academic Graph API documentation](https://api.semanticscholar.org/api-docs/graph)
- [Academic Graph OpenAPI spec (JSON)](https://api.semanticscholar.org/graph/v1/swagger.json)
- [Recommendations API OpenAPI spec (JSON)](https://api.semanticscholar.org/recommendations/v1/swagger.json)
- [Semantic Scholar API product page and API key request form](https://www.semanticscholar.org/product/api)
- [SPECTER2 (Ai2 blog)](https://medium.com/ai2-blog/specter2-adapting-scientific-document-embeddings-to-multiple-fields-and-task-formats-c95686c06567)

**arXiv**
- [arXiv API User's Manual](https://info.arxiv.org/help/api/user-manual.html)
- [arXiv API Terms of Use](https://info.arxiv.org/help/api/tou.html)

**bioRxiv / medRxiv**
- [bioRxiv API documentation](https://api.biorxiv.org/)

**OpenAlex**
- [OpenAlex API reference (new location)](https://help.openalex.org/api-reference/introduction)
- [New Features and Usage-Based Pricing (2026-02-24)](https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/)
- [Example costs — Pricing](https://help.openalex.org/access/example-costs/)
- [openalex-docs repository](https://github.com/ourresearch/openalex-docs)

**Zotero**
- Zotero schema version 42 (`itemTypes` definitions, read from the bundled `schema.json`) — field
  lists for `journalArticle`, `preprint`, `conferencePaper` in §10.3.

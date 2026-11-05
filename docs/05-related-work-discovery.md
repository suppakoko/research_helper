# 05 — Related-Work Discovery and Recommendation

**Project:** `research_helper` (Zotero 10.x bootstrapped plugin)
**Features covered:**
- **Feature 2** — given a selected paper, find related papers and add them to a Zotero collection.
- **Feature 6** — given an existing Zotero collection, recommend and search for new papers.
**Architecture constraint:** **fully client-side.** No backend, no server-side index, no shared
vector database. Every candidate must be generated from public APIs called directly by the plugin,
and every vector must live on the user's own disk.
**Verification date:** all live API probes were executed **2026-09-08**. Response bodies are real
and trimmed. See [doc 02](./02-literature-database-apis.md) for base URLs, auth, and rate limits;
this document does not repeat them.
**Re-verification pass 2026-09-09:** the Semantic Scholar Recommendations spec (`from` enum, `limit`
max 500, the `positivePaperIds`/`negativePaperIds` body schema), both `forpaper` pools, PubMed
`elink&cmd=neighbor_score`, `embedding.specter_v2` (768 dims, ~16 KB), OpenAlex `related_works`, and
the `citingPaper.references.*` nested-selector question (§2.2) were re-probed. Sections corrected by
that pass say so inline.

---

## Table of contents

1. [The shape of the problem](#1-the-shape-of-the-problem)
2. [Citation-graph approaches](#2-citation-graph-approaches)
3. [Semantic Scholar Recommendations API](#3-semantic-scholar-recommendations-api)
4. [PubMed Related Articles (`elink` / pmra)](#4-pubmed-related-articles-elink--pmra)
5. [Embedding-based similarity](#5-embedding-based-similarity)
6. [Feature 2 — related papers for one seed](#6-feature-2--related-papers-for-one-seed)
7. [Feature 6 — recommend from a collection](#7-feature-6--recommend-from-a-collection)
8. [Evaluation](#8-evaluation)
9. [Rate-limit-aware batching and caching](#9-rate-limit-aware-batching-and-caching)
10. [Sources](#sources)

---

## 1. The shape of the problem

"Related" is not one relation. Four families of signal exist, they surface **different** papers, and
a good recommender blends them rather than picking one.

| Family | Question it answers | Strength | Weakness |
|---|---|---|---|
| **Citation graph** | "What does this paper build on / who built on it?" | Precise, explainable, no ML | Cold-start on new papers; encodes the author's own biases; misses parallel work that doesn't cite |
| **Co-citation / coupling** | "What do people cite *alongside* this?" / "What does this paper read like?" | Surfaces intellectually adjacent work with no direct link | Expensive to compute client-side; noisy for review articles |
| **Text/embedding similarity** | "What is *about* the same thing?" | Works on brand-new papers; no citation needed | Blind to methodological kinship phrased differently; can drift to shallow topical matches |
| **Learned recommender** | "What would someone who liked this also want?" | Best single-shot quality; combines all of the above | Black box; one vendor; rate-limited |

**The core design tension for this project:** the highest-quality signal (Semantic Scholar's
recommender) sits behind a **1 request/second** keyed rate limit, and the second-highest (SPECTER2
embeddings) costs a request per paper at ~16 KB each. Everything below is shaped by that budget.

**Verified behavioural difference that motivates blending.** The same seed paper produces
completely different neighbourhoods from different services:

| Method | Top results for *Transfer learning enables predictions in network biology* (PMID 37258680) |
|---|---|
| PubMed `elink` pmra | PMIDs 42026145, 39636237, 41896605 — MeSH-similar biomedical articles |
| S2 Recommendations (`from=recent`) | 2026 bioRxiv preprints on single-cell foundation models |
| S2 citations | 2026 papers citing it, with sentence-level `contexts` |
| OpenAlex `related_works` | ten works, mostly **pre-2020** and topically loose |

No single one of those is "the answer."

---

## 2. Citation-graph approaches

### 2.1 Direct references and citations

The two first-order relations. Both are directly available from multiple APIs.

| Relation | Semantic Scholar | Europe PMC | OpenAlex | Crossref | PubMed |
|---|---|---|---|---|---|
| **References** (this → cited) | `/paper/{id}/references`, `limit ≤ 1000` | `/{src}/{id}/references` | `referenced_works[]` inline | `reference[]` in the work (publisher opt-in) | `elink&linkname=pubmed_pubmed_refs` |
| **Citations** (this ← citing) | `/paper/{id}/citations`, `limit ≤ 1000` | `/{src}/{id}/citations` | `cited_by_api_url` | `is-referenced-by-count` only (**count, not list**) | `elink&linkname=pubmed_pubmed_citedin` |
| Citation contexts | **Yes — `contexts`, `intents`, `isInfluential`** | No | No | No | No |
| Coverage | Broadest | Biomedical, good | Broad | Only where publishers deposited | PMC-derived, undercounts badly |

**Crossref cannot enumerate citing papers.** It gives `is-referenced-by-count` as an integer, and
outbound `reference` lists only when the publisher chose to make them public. It is a poor citation
source — use it for the count only.

*As built 2026-11-02 (`plan/08` `P5-T09`):* the adapter reads those outbound lists as `findRelated` `"references"`, because
they are the only reference source a seed without a key has outside biomedicine. An entry gives a DOI and no title
(doc 02 §5.3), so its record needs filling in from another source, and an entry with no DOI is counted and dropped.

**PubMed's citation links are PMC-derived and materially incomplete.** Europe PMC reported
**hitCount 857** citations for PMID 37258680 while Semantic Scholar reported
**citationCount 1220** for the same paper. Use PubMed `elink` for *related articles* (§4), not for
citation counts.

#### Semantic Scholar citations — real response

The `contexts` field is unique and genuinely valuable:

```
GET /graph/v1/paper/DOI:10.1038/s41586-023-06139-9/citations
      ?limit=2&fields=contexts,intents,isInfluential,title,year,externalIds,citationCount
```
```json
{"offset": 0, "next": 2, "data": [
  {"isInfluential": false,
   "contexts": [
     "A cellular expression profile can be represented as a set of gene-specific observations, with gene identity embeddings specifying which genes are present and expression embeddings describing their measured states [39, 8].",
     "…foundation models in natural language processing [11, 31, 3], a growing family of single-cell foundation models, including scBERT [44], Geneformer [39], scGPT [8], scFoundation [15], Stack [12], and STATE [1], has sought to leverage these large-scale transcriptomic resources to learn…",
     "Many existing single-cell foundation models rely heavily on masked expression reconstruction [44, 39, 15, 8], in which a subset of gene expression values is masked and the model is trained to recover the original observations."],
   "intents": [],
   "citingPaper": {"paperId": "d355eed61373d43a44aa34a6249acf4e8c05406b",
     "externalIds": {"DOI": "10.64898/2026.08.31.747784", "CorpusId": 291770057},
     "title": "scRep: A Latent-Space Self-Distilled Foundation Model for Single-Cell Representation Learning",
     "year": 2026, "citationCount": 0}},
  {"isInfluential": false, "contexts": [], "intents": [],
   "citingPaper": {"paperId": "16c3dda48b58efe96d4cf4af9a5f69fd360ea5bd",
     "externalIds": {"DOI": "10.3390/biology15171527", "CorpusId": 291795393},
     "title": "Biological Foundation Models for Complex Disease Research and Clinical Translation",
     "year": 2026, "citationCount": 0}}]}
```

Three uses for `contexts` beyond ranking:
1. **Explain the recommendation to the user** — "cited as: *…including scBERT [44], Geneformer [39],
   scGPT [8]…*" is a far better justification than "score 0.83."
2. **Feed the LLM** for feature 3's trend report — citation sentences say *why* work matters.
3. **Rank by depth of engagement** — a paper with three substantive contexts engaged more deeply
   than one with an empty `contexts` array. Note in the response above that both entries have
   `isInfluential: false` but wildly different context counts; **`contexts.length` is the more
   informative signal of the two.**

`intents` (`background`, `methodology`, `result`) is frequently empty in practice — treat it as a
bonus, never a filter.

*As built 2026-11-02 (`plan/08` `P5-T05`, against stand-in fixtures, `plan/00` §6 item 335(a)):* `findRelated` copies `contexts` onto `RelationEdge.contexts`, an empty array included, and reads neither `intents` nor `isInfluential`, which `RelationEdge` has no member for. `/references` has no recorded response, so its row is **assumed** to match the sample above with `citedPaper` in place of `citingPaper` (`P5-T31` checks it).

### 2.2 Co-citation

**Definition:** papers A and B are *co-cited* when some third paper C cites both. Co-citation
strength = the number of such C. High co-citation means the community treats A and B as belonging
together — this catches papers that never cite each other, including simultaneous discoveries and
competing methods.

**No API provides co-citation directly.** It must be computed:

```
cocitation(seed) =
   for each paper C in citations(seed):          # who cites the seed
       for each paper R in references(C):        # what else does C cite
           if R != seed: count[R] += 1
   rank by count[R]
```

**Cost analysis — this is the decision point.** With Semantic Scholar at 1 req/s:

| Step | Requests | Time |
|---|---|---|
| `citations(seed)` with `limit=100` | 1 | 1 s |
| `references(C)` for 100 citing papers | 100 | **100 s** |

100 seconds for one seed is not an acceptable interactive latency, and feature 6 would multiply it
by the number of seeds.

**Recommendation: implement a cheap approximation, not true co-citation.**

Request the citing papers' *references* inline in the **same** call via S2's nested field syntax:

```
GET /paper/{id}/citations?limit=100&fields=title,year,externalIds,citingPaper.references.externalIds
```

**Tested 2026-09-09 — it does not work, and it fails silently.** `citingPaper.references.externalIds`
on `/paper/{id}/citations` is **accepted** (HTTP 200, no `400`), but the returned `citingPaper`
objects contain **no `references` key at all** — the nested selector is ignored rather than rejected.
The bare form `references.externalIds` on the same endpoint *is* rejected:
`400 {"error":"Unrecognized or unsupported fields: [references.externalIds]"}`.

**Do not build on the inline form.** A silent omission is worse than a 400: co-citation would
quietly return zero counts for every seed and look like "this paper has no co-cited neighbours"
rather than like a bug.

**The approach that works (verified 2026-09-09):** collect the citing papers' IDs from one
`citations` call, then one `/paper/batch` POST (100 IDs) requesting `references.externalIds` —
`POST /graph/v1/paper/batch?fields=title,references.externalIds` returns a populated `references`
array. That is **2 requests, ~2 seconds** for a full co-citation neighbourhood. This is the design
to build.

**When to bother:** co-citation is most valuable for a *well-cited* seed (≥ 20 citations). For a
2026 preprint with zero citations it returns nothing. Gate it on `citationCount ≥ 20` and skip
otherwise — this also saves the request budget on exactly the papers where it would be wasted.

### 2.3 Bibliographic coupling

**Definition:** A and B are *coupled* when they share references. Coupling strength = |refs(A) ∩
refs(B)|. Where co-citation is a *backward-looking* signal that grows over time, coupling is
**available immediately on publication** — which makes it the right citation-based signal for
brand-new papers, exactly where the citation signal otherwise fails.

```
coupling(seed) =
   R = references(seed)                          # 1 request
   for each reference r in R:
       for each paper C in citations(r):         # |R| requests — too many
           count[C] += 1
```

Naive cost is |refs| ≈ 40 requests. **Prune first:** drop references cited by more than ~5,000
papers (methods papers, textbooks — they couple everything to everything and add pure noise), and
sample the 15 least-cited references, which carry the most specific signal. That is **1 + 15 = 16
requests ≈ 16 s** — acceptable for an explicit "find more like this" action, too slow for automatic
background use.

**Practical recommendation for feature 6:** compute coupling **only against papers already in the
user's collection**, which needs zero extra requests once references are cached:

```ts
// refs of collection papers are already fetched for the citation-expansion step;
// `collectionRefs` is the same Map stored as CollectionProfileDraft.refIndex (§7.2).
function couplingWithCollection(
  candidateRefs: Set<string>,                    // normalized ref DOIs of the candidate
  collectionRefs: Map<string, Set<string>>,      // paperKey -> ref DOIs
): number {
  // Guard the denominator: candidates whose references S2 does not have (very common for new
  // preprints) give candidateRefs.size === 0, and 0 / Math.sqrt(0) is NaN — which would then
  // propagate through Math.max into the final score and sort that candidate unpredictably.
  if (candidateRefs.size === 0) return 0;
  let best = 0;
  for (const refs of collectionRefs.values()) {
    if (refs.size === 0) continue;
    let shared = 0;
    for (const r of candidateRefs) if (refs.has(r)) shared++;
    // Normalize (Jaccard-ish) so long reference lists don't dominate
    best = Math.max(best, shared / Math.sqrt(refs.size * candidateRefs.size));
  }
  return best;
}
```

This turns coupling from an expensive candidate *generator* into a free re-ranking *feature*, which
is where it earns its keep.

### 2.4 What each API is actually for

| Purpose | Use | Not |
|---|---|---|
| Citation/reference lists | **Semantic Scholar** (contexts, best coverage, 1000/page) | Crossref (no citing list) |
| Citation lists when S2 is 429ing | **Europe PMC** `/citations`, `/references` | — |
| Citation *count* only | S2 → OpenAlex → Crossref | PubMed (undercounts) |
| MeSH-based related articles | **PubMed `elink`** | — |
| Learned recommendations | **S2 Recommendations API** | OpenAlex `related_works` |

**On OpenAlex `related_works`:** verified live, it exists and returns 10 IDs:

```json
{"id":"https://openalex.org/W4380563796",
 "doi":"https://doi.org/10.1056/nejmoa2300709",
 "title":"Base-Edited CAR7 T Cells for Relapsed T-Cell Acute Lymphoblastic Leukemia",
 "related_works":["https://openalex.org/W4232840848","https://openalex.org/W2026483119",
                  "https://openalex.org/W2339248413","https://openalex.org/W1573535810",
                  "https://openalex.org/W2365663712","https://openalex.org/W2269467004",
                  "https://openalex.org/W2168622279","https://openalex.org/W2032356997",
                  "https://openalex.org/W4232384826","https://openalex.org/W4250643158"],
 "referenced_works_count":25,"cited_by_count":333}
```

It is **concept-overlap based, fixed at 10, and skews old** — the IDs above are mostly `W20…`/`W23…`
(pre-2020 records) for a 2023 seed. Combined with OpenAlex's 2026 metering (doc 02 §9), this is
**not worth a request** for a plugin whose whole premise is *recent* research. Skip it.

Independently of that judgement: **OpenAlex is out of v1 entirely** (decision D2, `00-overview.md`
§3; `02-literature-database-apis.md` §9.3), so no OpenAlex adapter exists for this document's
features to call. Every OpenAlex row in the tables above is comparative evidence, not an available
option — the "Citation *count* only" chain, for instance, runs S2 → Crossref in v1.

---

## 3. Semantic Scholar Recommendations API

**This is the single best fit for feature 2**, and the backbone of feature 6.

Base URL: `https://api.semanticscholar.org/recommendations/v1`

### 3.1 The two endpoints

Confirmed against the live spec (`/recommendations/v1/swagger.json`, 2026-09-08):

#### `GET /papers/forpaper/{paper_id}` — one seed

| Param | Values | Default |
|---|---|---|
| `from` | **`recent`** or **`all-cs`** | `recent` |
| `limit` | 1 … **500** | 100 |
| `fields` | any `BasePaper` field | `paperId,title` |

`{paper_id}` accepts every ID prefix the Graph API does (`DOI:`, `PMID:`, `ARXIV:`, `CorpusId:`,
`PMCID:`, `MAG:`, `ACL:`, `URL:`, or a bare S2 SHA) — see doc 02 §6.3.

#### `POST /papers/` — multiple positive **and negative** seeds

```
POST /recommendations/v1/papers/?limit=100&fields=title,year,externalIds,venue,citationCount,abstract
Content-Type: application/json

{
  "positivePaperIds": ["DOI:10.1038/s41586-023-06139-9", "PMID:37258680"],
  "negativePaperIds": ["ARXIV:1706.03762"]
}
```

Body schema (verbatim from the spec): `positivePaperIds: string[]`, `negativePaperIds: string[]`.
`limit` and `fields` remain **query parameters**, not body fields — a common mistake.

**Verified live response:**

```json
{"recommendedPapers": [
  {"paperId": "80d9424076edc70cb172f635db2fa7e23a42874a",
   "externalIds": {"DOI": "10.64898/2026.07.26.740813", "CorpusId": 290649021},
   "title": "Interpretable gene networks from single-cell foundation models reveal conserved neurogenic dysfunction in Parkinson's disease",
   "venue": "bioRxiv", "year": 2026, "citationCount": 0},
  {"paperId": "e587694302b07b394e20e75be488cc4598ac4d41",
   "externalIds": {"DOI": "10.64898/2026.07.29.741565", "CorpusId": 290857895},
   "title": "Multi-scale modeling of human tissues from spatial transcriptomics with TERRA",
   "venue": "bioRxiv", "year": 2026, "citationCount": 2},
  {"paperId": "d355eed61373d43a44aa34a6249acf4e8c05406b",
   "externalIds": {"DOI": "10.64898/2026.08.31.747784", "CorpusId": 291770057},
   "title": "scRep: A Latent-Space Self-Distilled Foundation Model for Single-Cell Representation Learning",
   "year": 2026, "citationCount": 0}]}
```

**This is exactly what feature 6 wants** — 2026 preprints, zero citations, directly on-topic. A
citation-count-ranked approach would never surface these.

### 3.2 The `from` pool — verified, and it matters a lot

| Pool | Behaviour (verified) |
|---|---|
| `recent` (default) | Recently-published papers across all fields. For a 2023 biology seed, returned **2026 bioRxiv preprints**. |
| `all-cs` | The full computer-science corpus, no recency bias. For `ARXIV:1706.03762` (*Attention Is All You Need*) returned `"Transformer++"` (2020) and `"Parallel Attention Mechanisms in Neural Machine Translation"` (2018). |

```
GET /recommendations/v1/papers/forpaper/ARXIV:1706.03762?limit=2&from=all-cs&fields=title,year,venue,citationCount
```
```json
{"recommendedPapers": [
  {"paperId": "e42e3e09af8a56381c65aa8a8ddaee63fb321936",
   "title": "Transformer++", "venue": "arXiv.org", "year": 2020, "citationCount": 0},
  {"paperId": "2e7ddc611c414a0bf26e546f8dc743a5ac5842cf",
   "title": "Parallel Attention Mechanisms in Neural Machine Translation",
   "venue": "International Conference on Machine Learning and Applications",
   "year": 2018, "citationCount": 22}]}
```

**Decision: always use `from=recent`.** The project's whole premise is recent research (last 3
years), and `all-cs` is both off-brief and restricted to computer science. Do not expose `all-cs` in
the UI; it would be a footgun for a biomedical user.

**Consequence to design around:** because `recent` skews to preprints, expect a high preprint
fraction in recommendations. That is often *desirable* (bleeding-edge) but must be surfaced —
show a "preprint (not peer reviewed)" badge, and offer a "peer-reviewed only" filter.

### 3.3 Limits, errors, and pitfalls

| Item | Value |
|---|---|
| Max `limit` | **500** |
| Response size cap | **10 MB** → 400 `"Response would exceed maximum size…"`. With `abstract` requested, keep `limit ≤ 100` |
| 404 | `{"error": "Paper with id ### not found"}` — the *input* wasn't found |
| 400 | unrecognised fields, or the size cap |
| 429 | rate limit — see below |
| Rate limit | **1 req/s with a key**; unkeyed shares a saturated global pool |

**Pitfalls:**

1. **Fewer than `limit` results is normal.** The spec says methods "will return up to LIMIT
   recommendations if they are available." Never treat a short list as an error.
2. **A 404 on one seed kills the whole POST.** Validate every positive/negative ID against
   `/paper/batch` first (1 request for 100 IDs), and drop unresolvable ones. Otherwise one bad DOI
   in a 200-paper collection breaks the entire feature.
3. **No date filter exists.** You cannot ask for "last 3 years" — filter client-side on
   `year`/`publicationDate`. Over-request (`limit=200`) and trim.
4. **Recommendations are not deduplicated against your input.** Filter out the seeds yourself.
5. **Undocumented cap on `positivePaperIds`.**

> **Unverified:** the maximum number of `positivePaperIds` / `negativePaperIds` accepted by
> `POST /papers/`. The spec places no `maxItems` on either array. The probe above used 2 positives
> and 1 negative successfully. **Do not send a 500-paper collection in one call.** Cap at
> **10–20 positives** — both to stay safely inside untested territory and because a broad,
> heterogeneous seed set produces mushy recommendations (§7.2). Escalate cautiously and measure.

> **As built 2026-11-02 (`plan/08` `P5-T06`, against stand-in fixtures, `plan/00` §6 item 335(a)).**
> **DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313):**
>
> 1. **Limit and fields.** `limit` is clamped to 500. At 100 or below, `SEMANTICSCHOLAR_RECOMMEND_FIELDS` is sent,
>    `abstract` included; above 100, the same list without `abstract`, so §6.1's `limit=200` returns no abstracts and
>    hydration supplies them.
> 2. **Pitfall 2.** `recommend` validates positives and negatives in one `/paper/batch` with `fields=paperId,externalIds`,
>    index-matched. `RECOMMEND_MAX_POSITIVES` is 15 until `P5-T29` measures; the cap is applied after validation, so a bad
>    id does not cost a seed. Negatives have no cap here: `P5-T21` sends at most 10. An id listed both ways stays a positive.
> 3. **No seed left.** Positives that all fail validation throw `BadRequestError` with status 404, no POST sent, as
>    `plan/00` §6 item 332(c) reads "asked and does not hold". So does the batch's own 400, `No valid paper ids given`,
>    which `P2-T05` measured for a lone id it cannot read. No usable identifier at all is an empty page and a warning.
> 4. **Pitfall 4.** The input ids, and every id the batch returned for them, are filtered out of the answer, on the paper
>    id and on each identifier. `rank` is the position once the seeds are gone, as PubMed's is, so a seed in the list does
>    not lower `recScore` for what follows; a row the mapper drops still counts.
> 5. **The size cap.** Read off the response body's opening, `Response would exceed maximum size`, never the whole
>    message. One retry at `floor(limit / 2)` with the same fields; success carries a warning, and a second refusal
>    propagates as the `BadRequestError`. A `limit` of 1 is not retried.
> 6. **`findRelated`'s `"auto"` and no strategy mean `"recommendations"`:** one request, and §3 calls it the best fit.

### 3.4 Why not build our own recommender instead

Because the Recommendations API is trained on the full citation graph plus SPECTER embeddings, on
Semantic Scholar's infrastructure, updated continuously — and it costs **one request**. A
client-side reimplementation would need the citation graph (impossible without a backend) and would
still be worse. **Use it as the primary generator and spend local compute on re-ranking and
personalisation**, which is where a client-side system has the real advantage: it knows the user's
entire library, and Semantic Scholar does not.

---

## 4. PubMed Related Articles (`elink` / pmra)

### 4.1 How pmra works

PubMed's "Similar articles" is produced by **pmra** (*PubMed Related Articles*), a probabilistic
topic-based content-similarity model published by Lin & Wilbur (2007).

Key properties, and why they matter here:

- It models whether a document is about a topic using **term frequencies as Poisson
  distributions**, over title, abstract, and MeSH terms.
- It estimates **"relatedness"** — "the probability that a user would want to examine a particular
  document given known interest in another" — explicitly *not* query relevance. That is precisely
  the feature-2 question.
- Its parameters are estimated **without human relevance judgements**, using the existence of MeSH
  in MEDLINE as supervision. This is why it is unusually good in biomedicine and does not exist
  outside it.
- Evaluated against BM25 on the TREC 2005 Genomics collection, it showed "a small but statistically
  significant improvement… in terms of precision."
  ([Lin & Wilbur 2007, BMC Bioinformatics](https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-423))

**Practical consequence:** pmra is a *strong, free, unlimited-ish, MeSH-aware* signal for biomedical
papers, and **completely unavailable** for CS/physics/preprints. It is a complement to Semantic
Scholar, not a substitute.

### 4.2 The call

```
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi
      ?dbfrom=pubmed&db=pubmed
      &id=37258680
      &cmd=neighbor_score
      &linkname=pubmed_pubmed
      &retmode=json
      &tool=research_helper&email=suppakoko@gmail.com
```

**Verified live response:**

```json
{"header":{"type":"elink","version":"0.3"},
 "linksets":[{"dbfrom":"pubmed","ids":["37258680"],
  "linksetdbs":[{"dbto":"pubmed","linkname":"pubmed_pubmed",
   "links":[{"id":"42026145","score":28347383},
            {"id":"39636237","score":24718838},
            {"id":"41896605","score":22621790},
            {"id":"40106407","score":22588756},
            {"id":"40117988","score":21881630},
            {"id":"40191259","score":20828160},
            {"id":"41674879","score":19935353},
            {"id":"39761555","score":19756915},
            {"id":"39913993","score":18580666},
            {"id":"39229018","score":18472239},
            {"id":"37271050","score":18417129},
            {"id":"30537954","score":17737659}]}]}]}
```

### 4.3 Handling notes

| Item | Detail |
|---|---|
| `cmd=neighbor_score` | Returns `{id, score}` pairs. `cmd=neighbor` returns bare IDs — **always use `neighbor_score`**, same cost, more information. |
| Score scale | **Unnormalised, arbitrary magnitude** (~10⁷ here). Only comparable *within one linkset*. |
| Normalisation | `norm = score / maxScoreInSet`. Do this before blending with any other signal. |
| Self-match | The seed itself may appear (typically first, highest score). Filter by ID. |
| Result count | Long — often 100–300+. Slice client-side; there is no `retmax` for elink links. |
| Multiple seeds | `id` accepts a comma-separated list. **With `cmd=neighbor_score`, results are *merged* across inputs**, so you lose per-seed attribution. Pass `&id=a&id=b` as *separate `id` params* to get one `linkset` per input. |
| Recency | pmra has **no recency bias at all** — note `30537954` (`pubdate` "2018 Dec 12") ranked 12th on 2026-09-08 and 14th on re-probe 2026-09-09; positions drift as MEDLINE grows, so never hard-code a rank. Filter to the last 3 years client-side, or re-rank with a recency term (§7.4). |
| Other linknames | `pubmed_pubmed_reviews` (related reviews only), `pubmed_pubmed_combined`, `pubmed_pubmed_five` (top 5). `pubmed_pubmed_reviews` is a nice shortcut for "give me a review to orient myself." |
| Cost | 1 request per seed (or per batch), at 3–10 req/s. **The cheapest related-work signal available.** |

*Measured 2026-11-02 (`plan/08` `P5-T04`, fixture `elink-two-seeds`):* one run with two seeds returned exactly 100 links for each seed, against "often 100–300+" above, so whether 100 is a cap is unknown. Neither seed appeared in its own list, against "may appear" above; one run does not show it never does, so the filter stays.

*As built 2026-11-02 (`plan/08` `P5-T08`):* the seed is dropped first, then `norm = score / max` over what remains, then the list is sliced, so the top neighbour scores 1 even when the seed had been listed. One `elink` request carries up to 10 seeds (`PUBMED_ELINK_MAX_SEEDS`), where §4.4, §7.3's row b and §9.3's rank 3 count one request per seed. The adapter then spends one `efetch` per 200 distinct neighbours, which those rows do not count. A request carries `api_key` when the key store holds one, because `HOST_POLICIES` paces NCBI by the key's presence.

### 4.4 Where it fits

- **Feature 2**, when the selected item has a PMID → always call it. It is fast, free, and its
  MeSH grounding makes it the best complement to S2's citation-graph view.
- **Feature 6**, as a candidate generator over the collection's PMID-bearing papers: batch 10 seeds
  → 10 requests → ~1–3 s at 10 req/s with a key. Cheap enough to run every time.
- **Not applicable** to arXiv-only, preprint-only, or non-biomedical items.

---

## 5. Embedding-based similarity

### 5.1 Two routes, and they are not equivalent

| | **SPECTER2 from Semantic Scholar** | **Generate your own (OpenAI / Gemini / Voyage)** |
|---|---|---|
| Cost | Free (inside the API rate limit) | Per-token; user's own key |
| Latency | 1 req/s keyed; batched 100/call | Batched 100s/call, fast |
| Dimensions | **768** (verified) | 1536 / 3072 / 1024, configurable |
| Trained on | Scientific papers + **citation graph** | General text |
| Available for | Papers **in the S2 corpus** | Anything with a title + abstract |
| Semantics | "Cited together" ≈ close | "Worded alike" ≈ close |
| Reproducible across users | Yes — everyone gets the same vector | Only within one provider+model |

**The decisive argument for SPECTER2:** it is trained with a contrastive objective on **citation
triplets** — a paper is pulled toward the papers it cites and away from random papers. That means
cosine distance in SPECTER2 space approximates *"researchers treat these as related,"* which is the
actual target. A general-purpose text embedder approximates *"these abstracts use similar words,"*
which is a proxy for the proxy. For scientific recommendation SPECTER2 is the better-aligned tool
even though it is smaller.

**Recommendation:**

1. **Default: SPECTER2 via Semantic Scholar.** Free, task-appropriate, shared vector space with the
   recommender itself.
2. **Fallback: user's existing LLM provider key** for papers S2 doesn't have (new preprints,
   non-indexed venues) and for users who decline an S2 key.
3. **Never mix the two in one cosine computation** — different spaces, meaningless distances. Store
   the model name with every vector and compare only within a model.

### 5.2 SPECTER2 in practice

**Verified live 2026-09-08:**

```
GET /graph/v1/paper/DOI:10.1038/s41586-023-06139-9?fields=title,embedding.specter_v2
```
```json
{"paperId": "7d1e59ce254bea5228da634dbe7c5c4160df6f98",
 "title": "Transfer learning enables predictions in network biology",
 "embedding": {"model": "specter_v2",
   "vector": [0.7878396511077881, 0.8180338740348816, -0.29438433051109314, -0.184433475136, …]}}
```

Measured: **768 floats**, **~16 KB of JSON** per paper.

- Request `embedding.specter_v2`. Plain `embedding` returns **SPECTER v1** — a different space.
- Batch via `POST /paper/batch?fields=embedding.specter_v2`. Two caps apply and the ID cap binds
  first: `/paper/batch` accepts at most **500 IDs** per call (doc 02 §6.8), and the **10 MB**
  response cap would in any case stop you near 640 (10 MB ÷ ~16 KB). **Use 200 per batch** for
  headroom against both.
- Vectors are **not L2-normalised** on arrival. Normalise once at ingest, then cosine similarity
  reduces to a dot product.

```ts
function l2normalize(v: number[]): Float32Array {
  const out = new Float32Array(v.length);
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}
/** Both vectors must be pre-normalised and from the same model. */
function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;                                   // already in [-1, 1]
}
```

> **As built 2026-11-02 (`plan/08` `P5-T20`; `ensureEmbeddings` and `cosine` in `src/pipeline/shared/embeddings.ts`).** Since
> `plan/00` §6 item 320(b), §5.1's item 2 and §5.3 are not built: the routes are this section with a key and §5.5 without.
> §5.1's table says "batched 100/call" and this section says 200; 200 is built. The worked example above is the only
> recorded vector. **Nobody has seen `/paper/batch` answer `embedding.specter_v2`**, so the batch's row shape, its 768
> values and what a paper with no vector looks like are assumptions until `P5-T31`; `test/fixtures/semanticscholar/related/`
> holds a stand-in, `"synthetic": true`. `07-architecture-and-data-model.md` §9.2's note of this date holds the decisions,
> and this section's two functions differ in one way: `cosine` also carries each vector's model, and refuses two.

### 5.3 Third-party embedding providers (fallback path)

Verified from vendor documentation and pricing pages, 2026:

| Provider | Model | Dims | Max input | Price / 1M tokens |
|---|---|---|---|---|
| OpenAI | `text-embedding-3-small` | 1536 (Matryoshka → 512, 256) | 8191 tokens | **$0.02** |
| OpenAI | `text-embedding-3-large` | 3072 (→ 1024, 256) | 8191 tokens | $0.13 |
| Google | `gemini-embedding-001` | 3072 (MRL → 1536, 768) | 2048 tokens | $0.15 |
| Voyage | `voyage-4-lite` | — | — | $0.02 |
| Voyage | `voyage-4` / `voyage-4-large` | — | — | $0.06 / $0.12 |

> **Unverified:** Voyage voyage-4 dimension counts and context limits were not confirmed against
> Voyage's own documentation; the pricing figures come from third-party comparison sites. Confirm at
> docs.voyageai.com before shipping a Voyage adapter.

**Cost reality check.** A title + abstract is ~300 tokens. A 500-paper collection ≈ 150 K tokens.

| Model | One-time cost for 500 papers |
|---|---|
| `text-embedding-3-small` | **$0.003** |
| `gemini-embedding-001` | $0.023 |

**Embedding cost is negligible.** The real costs are latency, key management, and the fact that
Gemini's 2048-token limit will truncate long abstracts (OpenAI's 8191 will not).

**Recommendation:** if a third-party fallback is built, use **`text-embedding-3-small` with
`dimensions: 768`**. Rationale: cheapest, longest context, and Matryoshka truncation to 768 makes
the storage layout identical to SPECTER2's — one vector width, one storage schema, one code path.
The vectors still are not interchangeable, but the *plumbing* is.

Doc 03 covers provider auth; note that a user who supplied only an **Anthropic** key cannot embed
at all (Anthropic ships no embedding endpoint) — the UI must handle that case by falling back to
SPECTER2 or to lexical similarity (§5.5).

### 5.4 Where to store vectors client-side

**No backend, so vectors live on the user's machine.** Scale first:

| Library size | Vectors (768 × float32) | Raw bytes | Verdict |
|---|---|---|---|
| 500 | 500 × 3 KB | **1.5 MB** | trivial |
| 5,000 | 5,000 × 3 KB | **15 MB** | fine |
| 20,000 | 20,000 × 3 KB | **60 MB** | fine on disk; **do not hold in memory** |
| 100,000 | 100,000 × 3 KB | 300 MB | needs on-disk paging |

A brute-force cosine scan over 20,000 × 768 float32 is ~15 M multiply-adds — **a few tens of
milliseconds** in JS with `Float32Array`. **No ANN index is needed.** Do not build one; it is pure
complexity for zero benefit at these sizes.

**Storage options, ranked:**

| Option | Verdict |
|---|---|
| **Plugin-owned SQLite table** via `Zotero.DB` | **Recommended, and the option `07-architecture-and-data-model.md` §8.3 selected.** Store as a `BLOB` (raw `Float32Array` buffer, 3072 bytes), keyed by canonical work key + model name. Transactional, lives in the Zotero **data** directory so it travels with the user's backups (doc 09 §1.6), queryable alongside item data. |
| **A file under the Zotero data directory** (`vectors-<model>.bin` + a JSON index) | Good alternative. Simplest, fastest bulk load via a single `IOUtils.read`. Use if you want to avoid touching the Zotero DB schema. |
| IndexedDB | Available in the privileged context but adds an async layer for no gain over SQLite here. |
| Zotero item `extra` field or a note | **No.** 16 KB of JSON per item bloats sync, is visible to the user, and will be corrupted by editing. |
| `Zotero.Prefs` | **No.** Prefs are for small scalars. |

**Never store vectors in fields that sync.** Zotero sync uploads item data to the user's account;
768 floats per item would balloon their sync payload and quota for data that is trivially
recomputable. Keep vectors in a **local-only cache** with a version/model tag, and treat cache loss
as a non-event (re-fetch).

The table itself is **owned by `07-architecture-and-data-model.md` §8.3**, which declares it as
`embedding` in the plugin's own `research-helper.sqlite`. Reproduced here so this document reads on
its own; §8.3 wins on any disagreement, and a new column goes there first:

```sql
CREATE TABLE embedding (
  work_key   TEXT NOT NULL,       -- CanonicalWork key (normalized DOI etc.)
  model      TEXT NOT NULL,       -- 'specter_v2' | 'text-embedding-3-small@768'
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL,       -- Float32Array bytes, L2-normalized
  created_at INTEGER NOT NULL,
  PRIMARY KEY (work_key, model)
);
CREATE INDEX idx_embedding_model ON embedding(model);
```

The primary key is `(work_key, model)`, so "load every vector for model X" — the bulk read this
ranking pass does on every run — cannot use it and would otherwise be a full table scan over every
vector the plugin has ever cached. `idx_embedding_model` above is the index that serves it; it is
declared in **`07-architecture-and-data-model.md` §8.3**, which owns the schema.

### 5.5 Lexical fallback when no embeddings are available

When the user has no S2 key and no embedding provider, do not disable the feature — degrade to
**TF-IDF cosine over title + abstract + MeSH**, computed entirely locally:

- Build the IDF table from the user's own collection (a few hundred documents is enough for stable
  IDF on domain terms).
- Weight MeSH descriptors 2× and title terms 1.5× over abstract terms.
- Quality is clearly worse than SPECTER2, but it is instant, free, private, and always available.
  Label it in the UI as "basic similarity."

> **As built 2026-11-02 (`plan/08` `P5-T19`; `lexicalSpace` in `src/pipeline/shared/lexical.ts`).** Since
> `plan/00` §6 item 320(b) there is no embedding provider in v1: this floor is what a run without a Semantic
> Scholar key uses. The vector of a work holds, per word,
> `Σ over its fields of fieldWeight × (1 + ln countInField)`, times `ln(1 + (1 + N) / (1 + df))`, scaled to unit
> length; the score is the two vectors' dot product. Field weights are the three above: abstract 1, title 1.5,
> MeSH 2. `N` and `df` come from the corpus the caller supplies, where `df` counts documents, once per word across
> all three fields, and is 0 for a word the corpus lacks.
>
> **DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313):**
> 1. **The IDF is §7.2's `Math.log(1 + size / (1 + count))` with one added to the numerator,** so it is above 0
>    for every corpus. A plain `log(N / df)` is 0 for a word in every document, and a work in a one-document corpus
>    would then have no vector and could not score 1 against itself. An empty corpus is legal and weighs all words
>    alike.
> 2. **Repeats within a field count as `1 + ln count`, not as a plain count, and there is no stop-word list.**
>    Measured 2026-11-02 on 142 recorded PubMed abstracts from the six fixture files holding at least 15, taking
>    "same file" as a rough stand-in for "same topic", with a 29-document corpus: the chance that a same-file pair
>    outscores a different-file pair was 0.827 with plain counts, 0.899 with `1 + ln count`, 0.913 with plain counts
>    and a 40-word English stop list, 0.921 with both. A list would add a little for English only; this rule is
>    the same for every script.
> 3. **Words of all fields share one vocabulary, MeSH descriptors split into words,** so a title's `CRISPR` meets
>    the descriptor `CRISPR-Cas Systems`. A descriptor repeated on a work counts once, because a merged work can
>    carry it from two sources.
> 4. **Only `Subject.scheme` `"mesh"` is read.** Other schemes and `keywords` are not, as this section names MeSH
>    only. `isMajor` and §7.2's check-tag list are not applied here: the IDF already discounts `Humans` once a corpus
>    has it often, and §7.2 is about choosing profile terms.
> 5. **A work with no usable text has an empty vector and scores 0 with everything, itself included.** There is
>    no evidence that it resembles anything, and no `NaN`.
> 6. **The score is already in [0, 1], so it does not pass through §7.4's `(cosine + 1) / 2`.** Rescaled, a pair
>    with no word in common would read 0.5 and `novelty` could never pass 0.5. `P5-T24` reads it as it is.
> 7. **The label id is `basic-similarity`** (`LEXICAL_SIMILARITY_LABEL_ID`). `lexicalSpace` adds no user-visible
>    string.
>
> **On the same 142 abstracts:** same-file pairs averaged 0.137 (highest 0.391), different-file pairs 0.048
> (highest 0.241), and no pair reached §7.2's diversification cut of 0.92. So scores here are not on SPECTER2's
> scale and a threshold set for one means nothing on the other.
>
> **Text outside the Latin script does not crash it, and overlap is weaker.** Words are `normalizeTitle`'s:
> letters and digits of every script are kept, and everything else separates words. Korean splits at spaces only,
> so `유전자` and `유전자의` are different words. Chinese has no spaces, so a whole run is one word and only an exact
> repeat of the run matches. A combining mark splits a word, because `normalizeTitle` keeps only letters and digits:
> Japanese `がん` becomes `か ん`, and Thai and Devanagari words break at their vowel signs. The fragments are the same
> each time, so two equal texts still score 1. `test/unit/pipeline/lexical.test.ts` pins the Korean and Chinese cases.
>
> **Limits of what was measured:** the 0.827–0.921 figures are one small sample and "same file" is a proxy; no
> human judged a pair, and no Korean abstract was in it.

---

## 6. Feature 2 — related papers for one seed

The simple case: one selected Zotero item, produce a ranked list, write the accepted ones to a
collection.

### 6.1 Pipeline

```
selected Zotero item
   │
   ├─ resolve IDs (DOI / PMID / arXiv) ─────────── 0–1 requests (doc 02 §6.3)
   │
   ├─ generators (parallel, budget-aware)
   │    A. S2 Recommendations forpaper   from=recent, limit=200      1 req
   │    B. S2 references                 limit=100                   1 req
   │    C. S2 citations                  limit=100, +contexts        1 req
   │    D. PubMed elink pmra             neighbor_score              1 req   (if PMID)
   │    E. Europe PMC citations/refs     (fallback if S2 429s)       0–2 req
   │
   ├─ union + dedup (doc 02 §11)
   ├─ hydrate metadata            /paper/batch, 100/call             1–3 req
   ├─ score and rank              §6.2
   ├─ filter: already in library, date window, type
   └─ present ranked list with per-item provenance
```

*Corrected 2026-11-02 (`plan/08` `P5-T01`): the resolve line cited doc 02 §3.7, which is the PMC ID converter. The cross-ID resolver is Semantic Scholar's `/paper/batch`, whose `{paper_id}` forms are doc 02 §6.3. The converter still resolves a PMCID, and it is the only resolver a run without a key has (`plan/08` `P5-T11`).*

**Seed resolution and its title-match threshold (FR-13, FR-14).** Written 2026-11-02 (`plan/08` `P5-T11`). Built by
`resolveSeed` and `expandSeedIds` in `src/pipeline/related/seed.ts`.

A seed holding a DOI, PMID, PMCID or arXiv ID is resolved at once, with no request; so is one holding a Semantic Scholar
corpus id when the run has a key, because no other service reads that id. Expansion then fills in the identifiers it
lacks: one Semantic Scholar `lookup` when the run has a key, and the PMC converter for a PMCID when it has none or `lookup`
found nothing or failed. A seed holding no identifier asks for its **title only**: Crossref `matchTitle` always, Semantic
Scholar `matchTitle` only with a key. Nothing else about the item leaves the machine (`docs/09` §3 row 2). So the diagram's
"0–1 requests" holds for a seed with an identifier; a title-only seed costs 1 request without a key and 3 with one (two
title asks and the `lookup`), plus one converter request in the corners above.

**The threshold. DECIDED 2026-11-01 (coordinator, under `plan/00` §6 item 313; `plan/08` §0.4 line 9).** A candidate
passes when, on `normalizeTitle`'s form of both titles:

- `levSim` ≥ `LEVSIM_DUPLICATE_THRESHOLD` (0.95), or
- `levSim` ≥ `LEVSIM_CORROBORATED_THRESHOLD` (0.88) with |year delta| ≤ `MAX_YEAR_DELTA` (1) and the first author's
  family name matching.

No constant is respelled: `src/sources/shared/dedupe.ts` declares them, so tuning them for deduplication moves this
threshold too. This is not the cascade's table of `docs/02` §11.3.3: the 0.95 row asks for no year, because a title-only
item often has none, and the 0.88 row asks for no Jaccard score. Exactly one passing work resolves, flagged "matched by
title". Two or more means the user picks (FR-14 scenario 2). None is an error naming DOI, PMID, arXiv ID and title.

**DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313), additions to the threshold:**

1. `docs/02` §11.3.3's false-positive guards apply, because they name a wrong paper here as they name a wrong merge there.
   Titles whose series marker or any number differs never pass. A title under `MIN_FUZZY_TITLE_TOKENS` (5) words passes
   only through the corroborated row, so "Editorial" alone resolves nothing, while "Deep learning" with its year and first
   author still does.
2. **A non-paper is rejected before the text is compared:** `type` `"other"` with no year. Text cannot do this: the
   recorded `10.1021/jacs.5c03749.s001`, a Crossref `component` with `[[null]]` dates, has what reads as a whole article's
   title, so a seed with that title compares at 1.000. S2's mapper also gives an unclassified paper `"other"`, which is why
   a year keeps a record in. Two recorded components are all this rests on. A `component` that does carry a date is not
   caught and reaches the user's list, where it is visible rather than silently chosen.
3. A candidate with no identifier is rejected, because it could not seed anything.
4. The same paper from both services counts once. Passing records go through `dedupeRecords` and each group is one
   candidate, so a Crossref record and an S2 record with one DOI resolve instead of asking.
5. A service that fails does not end the run while another found a match. If none passes and a service failed, its error
   is rethrown rather than the "no match" error, because that service might have held the paper.

**Starting values, not measured.** Nobody has measured this threshold on title matches. What exists:

- **Crossref, one real search** (`title-search`, recorded 2026-11-02, `synthetic` false), for one paper's exact title:
  similarity 1.000 for that paper, then 0.750, 0.677, 0.352 and 0.266, so one of five passes. No candidate falls in the
  0.88–0.95 band, so the corroborated row has met no real title, and one query says nothing about how often the
  threshold is right.
- **Semantic Scholar, none.** `/paper/search/match`'s fixtures are hand-written stand-ins (`plan/00` §6 item 335(a)). A test
  passing over them shows the code reads that assumed shape and is not evidence about the service.
- `P2-T13`'s labelled corpus tunes the same constants, on pairs of records for deduplication, not on a seed against a
  service's answer.

**What will measure it:** `plan/08` `P5-T30`'s run, under its note of 2026-11-02: items of known DOI, resolved with the DOI
withheld, counted as right, wrong, asked or none. `P5-T31` supplies only Semantic Scholar's real answer shape, for one hit
and one miss.

**Total: 5–8 requests, ~6–9 seconds** at S2's keyed 1 req/s. Acceptable for an explicit user action
with a progress indicator. Run generators concurrently across *different hosts* (NCBI and S2 have
independent budgets); serialise within a host.

> **As built 2026-11-02 (`plan/08` `P5-T12`; `runRelatedGenerators` in `src/pipeline/related/generators.ts`).** The list
> above gains **Crossref's deposited references** (`/works/{doi}`, §2.1), one request, after Europe PMC. Co-citation stays
> out (`plan/00` §6 item 321(c)). **DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313):**
>
> 1. **Budget.** `RELATED_REQUEST_BUDGET` is 8, the top of the 5–8 above, and `RELATED_HYDRATION_RESERVE` is 2 of them.
>    **Both are starting values, not measurements;** `P5-T30`'s live run is the first thing that can test them. The
>    spending order is `RELATED_GENERATORS`: recommendations, PubMed's similar articles, Semantic Scholar's citations and
>    references, Europe PMC's citations and references, Crossref's references. It keeps §9.3's relative order. Similar
>    articles count 2 (`elink` and one `efetch`, because the adapter hydrates), and a Europe PMC call counts 2 when it
>    holds neither a PMID nor a PMCID (`plan/08` `P5-T07`). A cached answer costs nothing.
> 2. **What that buys.** With a key and a healthy Semantic Scholar, its three calls and the similar articles take 5, one
>    Europe PMC call may fit, and the rest read "over budget": E is the fallback this diagram draws. **If Semantic
>    Scholar's citations or references do not answer, or answer nothing,** a second wave runs the Europe PMC and Crossref
>    generators that were over budget, and it may spend the reserve, except that Crossref leaves 1 request, since its
>    records have no title until hydrated. Without a key: 2 + 2 + 1 = 5, plus the reserve.
> 3. **A DOI-only seed is expanded once.** One Europe PMC `lookup` (`metadata`, cached) reads its PMID and PMCID, so
>    similar articles can run on a keyless DOI seed and Europe PMC's two calls cost one each. A seed it does not hold, or
>    holds with neither id (a preprint), reads "not indexed" there with no further request.
> 4. **Hydration is of merged works only (§9.1 item 2), and only of what they lack.** A blank title on any run; on a keyed
>    run also a missing abstract, because `forpaper` above 100 requests no abstract. Semantic Scholar's `lookup` first when
>    keyed, then Europe PMC's; Europe PMC's alone without a key. *(Since 2026-11-05, `P5-T32`: Crossref's `lookup` follows
>    on both, for blank titles; the "Measured 2026-11-05" note below.)* PubMed's records arrive hydrated and a `PPR` row has no
>    identifier, so neither is asked. Answers join the union and it is merged again, so `merge` chooses each field. Then
>    `backfillAbstracts`, whose `selected` omits Semantic Scholar without a key (§0.2 item 19 of `plan/08`). Both go
>    through one per-identifier `metadata` cache, a run does not ask again what a source already answered even with the
>    cache off or failing, and a share the budget cannot cover is counted once, not sent. A lookup that failed is
>    remembered nowhere, so the fill-in may ask its identifiers once more.
> 5. **A work that still has no title is left out of the candidates and counted** (`hydration.untitled`): nothing can be
>    shown or imported for it.
> 6. **Status rows** are `RelatedGeneratorState`: `answered`; `no-key`; `not-indexed` (a 404, live or from the negative
>    cache); `could-not-ask` (the seed lacks the identifier, or an empty page with a warning, which is never cached:
>    `plan/00` §6 item 332(c)); `rate-limited`; `over-budget`; `failed`, with the error's code. No sentence is built here.
> 7. **`ARXIV:` for an arXiv DOI (`plan/00` §6 item 337(c)).** Every Semantic Scholar call of this run sends a seed or work
>    holding a `10.48550/arXiv.*` DOI by its arXiv id alone, so no "not indexed" is cached from a `DOI:` request `P2-T05`
>    measured `/paper/batch` not to resolve. Whether `/references` and `/citations` read `ARXIV:` is unmeasured; `P5-T31`
>    may settle it. `semanticScholarIdsOf` is the `ExternalIds` form of `toEmbeddingPaperId` (`P5-T20`), since `findRelated`
>    reads `ExternalIds`; the two share `ARXIV_DATACITE_DOI` and a test holds them to one answer.
> 8. **The union holds one record per `SourceRecord.id`, with a list of edges per id.** Measured 2026-11-05 in a scratch
>    test: `dedupeAndMergeAsync` does not throw on one record given twice, but returns **two** merged works for it, each
>    with its one record. The union therefore never hands it a duplicate id.
>
> **Not measured, by instruction (no live call that round): how many of `work-with-references`' 155 DOIs Europe PMC
> resolves.** The measurement is `createEuropePmcSource`'s `lookup` over those DOIs (2 requests, free, unkeyed), counting
> records with a title, and then the same on a non-biomedical seed, because the recorded seed is a *Nature* paper and the
> question is about seeds with nothing else: a keyless, non-biomedical seed reaches titles only this way. **Starting value:
> Europe PMC is treated as enough, and Crossref has no `lookup`.** Counted offline the same day: 155 DOIs, 46 under
> `10.1038`, 38 under `10.1016`, 6 under `10.48550`. If fewer than about 20 of the 100 asked come back with a title on such
> a seed, the definition of done's "still returns useful candidates" is at risk, and the next step is a Crossref `lookup`
> over `filter=doi:` (`docs/02` §5.2) with one free recording.
>
> **Measured 2026-11-05 (`plan/00` §6 item 339(d)), one reading each, three free unkeyed `searchPOST` requests through the
> shipped `createEuropePmcSource` `lookup` and the project's User-Agent, 200 JSON each.** The biomedical set is
> `work-with-references`, the recorded Crossref body of a *Nature* paper: 155 asked, 146 answered, 146 with a title, 145 with an
> abstract (first batch of 100: 95 answered and titled; two requests). The 9 unanswered are all 6 under `10.48550`, both under
> `10.1109`, and one `10.1016`. **The fixtures hold no non-biomedical seed's reference list**: `work-with-references` is the
> only one with a `reference` member. DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313): the second reading uses a
> stand-in set, 51 DOIs filtered from six recorded Crossref result lists (computer vision, language models, graph networks,
> physics, humanities book parts), one request. It is a set of works, not one seed's references. Answer: 51 asked, 2 answered, 2 with a title, 2 with an
> abstract, both IEEE; without the 21 book parts, 2 of 30. **The line of fewer than about 20 of 100 is crossed on this stand-in
> (scaled, about 10 of 51).** The starting value above has not been changed: whether to add a Crossref `lookup` is the
> coordinator's, and one seed's real reference list would be the stronger reading.
>
> **Measured 2026-11-05 (`plan/08` `P5-T32`, `plan/00` §6 item 344(b)): one real non-biomedical seed's references.** One
> reading, one seed, picked by hand: *ImageNet Large Scale Visual Recognition Challenge* (`10.1007/s11263-015-0816-y`,
> computer science, 2015), the first tried, so finding it took one request. It deposits 102 references, 42 with no DOI, and
> 60 distinct DOIs, 37 of them under `10.1109`. None is under `10.48550`, so a newer paper would read worse. Free and unkeyed,
> through the shipped adapters:
>
> | `lookup` | Asked | Answered | With a title | With an abstract |
> |---|---|---|---|---|
> | Europe PMC, one request | 60 | 9 | 9 | 9 |
> | Crossref, one request | 60 | 60 | 60 | 3 (read from the raw body: this count's mapper had no XML parser, so it mapped none) |
> | Crossref over the 51 Europe PMC left | 51 | 51 | 51 | not counted |
>
> **The line of fewer than about 20 of 100 is crossed on a real reference list too (9 of 60), and the starting value above
> is superseded.** Crossref's `lookup` is built, and Crossref answers what its own `reference[]` deposited.
>
> **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313), hydration as of `P5-T32`:**
>
> 1. **The order is Semantic Scholar when keyed, then Europe PMC, then Crossref, and Crossref is asked for blank titles only.**
>    Crossref-first would cost the same requests when both fit, but it would make a titled row not worth asking of Europe
>    PMC, whose abstracts and PMIDs would then be lost, since the fill-in merges abstracts only. On the *Nature* seed Crossref
>    is then asked about 5 of 100, and on this seed 51 of 60.
> 2. **`RELATED_REQUEST_BUDGET` stays 8 and `RELATED_HYDRATION_RESERVE` stays 2.** The worst keyless case is a DOI-only biomedical
>    seed: expansion 1, similar articles 2, Europe PMC's two lists 1 + 1, Crossref's references 1, which is 6, and leaves 2 for
>    one Europe PMC lookup and one Crossref lookup. The fill-in then has no request; its share is counted in
>    `hydration.unsent`. A title is worth more than an abstract, because an untitled row is dropped. That costs little, since
>    the recorded Europe PMC relation rows hold no DOI (0 of 25, 25 and 1), so the fill-in could ask only rows with one. A
>    DOI-only non-biomedical seed spends expansion 1, references 1, Europe PMC's lookup 1 and Crossref's 1, so 4 of 8. These
>    are arithmetic on the planned order; `P5-T30`'s live run is what tests them.
> 3. **A `10.48550/arXiv.*` DOI is not sent to Crossref**, because DataCite holds it (6 of 6 unanswered). Such a row stays untitled
>    without a key, is dropped and is counted in `hydration.untitled`. So a keyless, recent machine-learning seed loses those
>    rows. Europe PMC is still asked about them (0 of 6 on the *Nature* seed), which spends no extra request.
> 4. **`hydration.sent` and `unsent` count a source and an identifier together**, so one DOI asked of both Europe PMC and
>    Crossref counts twice.
> 5. **Crossref stays out of `ABSTRACT_BACKFILL_LADDER`** (`plan/00` §6 item 193): its 3 abstracts of 60 reach the work only as
>    part of the record `lookup` returns, and no request is made for one.

> **As built 2026-11-05 (`plan/08` `P5-T14`; `createRelatedPipeline`, `docs/07` §12.2's note).** **DECIDED 2026-11-05
> (coordinator, under `plan/00` §6 item 313):**
>
> 1. **Seed requests and vector batches stay outside `RelatedGeneratorOptions.budget`.** The budget of 8 is about how many
>    relations a seed is asked for. The seed's two stages send 0–4 requests and `ensureEmbeddings` sends ⌈n / 200⌉ batches,
>    and neither grows with the number of generators. Both are counted in `estimate`'s `externalRequests`. (`plan/08`'s note
>    says 0–3. Read from `seed.ts`, the most is two title matches, then a lookup that finds nothing, then the PMC converter.)
> 2. **A run without a usable key reads as keyless everywhere.** A key store whose `has` says yes while its value is blank
>    or unreadable gives "no key" rows, the key notice and the lexical space. The probe is `hasUsableApiKey`; a true probe
>    followed by an empty `lookupKeyed` would otherwise store a week of "missing" rows for works Semantic Scholar holds.
> 3. **The filter is one step.** A candidate is dropped as the seed when its work key is the seed's, or any identifier is
>    one of `seedIds`; it is dropped for its type only when that type is `dataset`.
> 4. **Nothing is measured here.** Whether rows are enough on a real seed is `P5-T30`'s, and Semantic Scholar's behaviour
>    through `lookupKeyed` is `P5-T31`'s, because its fixtures are stand-ins.

### 6.2 Scoring

Each generator contributes a normalised score in [0,1]; blend and add global quality terms.

```
score(c) = w_rec · recScore(c)
         + w_pmra · pmraScore(c)
         + w_cite · citeScore(c)
         + w_emb  · cosine(v_seed, v_c)
         + w_rec_y · recency(c)
         + w_qual · quality(c)
         − w_dup  · alreadyOwned(c)
```

| Term | Definition |
|---|---|
| `recScore` | `1 − rank/limit` if returned by the Recommendations API, else 0 |
| `pmraScore` | `elink score / max(elink scores)`, else 0 |
| `citeScore` | `1.0` direct reference or citation; `+0.2` bonus if `contexts.length ≥ 2`; capped at 1 |
| `cosine` | SPECTER2 cosine to the seed, rescaled from [-1,1] to [0,1] |
| `recency` | `exp(−ageYears / τ)`, τ = 2.0 |
| `quality` | `log10(1 + citationCount) / 3`, clipped to [0,1] |
| `alreadyOwned` | 1 if already in the user's library |

Suggested starting weights for feature 2 (a user asking "what's related to *this*" wants topical
proximity above novelty):

```
w_rec = 0.30, w_pmra = 0.20, w_cite = 0.20, w_emb = 0.20,
w_rec_y = 0.05, w_qual = 0.05, w_dup = 1.0 (i.e. exclude outright)
```

**Multi-generator agreement is the strongest signal available.** A paper found by *both* pmra and
the S2 recommender is far more likely to be relevant than one found by either alone. Add a small
explicit bonus rather than relying on the sum:

```
agreement = (number of generators that returned c) − 1
score += 0.08 × min(agreement, 3)
```

> **As built 2026-11-05 (`plan/08` `P5-T13`; `scoreRelatedCandidates` in `src/pipeline/related/score.ts`).**
>
> **The numbers are unmeasured starting values.** The six weights above (they sum to 1.00), τ = 2.0, the 0.08 and the cap
> of 3 ship exactly as this section suggests them, and no run has tested any of them. **What will measure them is §8.1–§8.2's
> held-out precision@k and ablation, which are backlog (`plan/00` §6 item 323(d)), so nothing in Phase 5 measures them.**
> `G-27` judges recommendations, not this list. `plan/08` `P5-T30`'s related run is the first look at the order on a real
> seed: one reading, with no ground truth.
>
> **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313):**
>
> 1. **`w_dup` and `alreadyOwned` are not applied.** "Exclude outright" contradicts FR-16 and `docs/07` §12.2, where a library
>    item is kept, marked and unticked, and scoring runs before `MarkingRows` knows the library. The score has no such
>    input. §6.1's "filter: already in library, date window" is read the same way: both are marks, and only the seed and
>    excluded types are dropped (`docs/07` §12.2).
> 2. **`citeScore` is 1 for any reference or citation edge, and the +0.2 is not built.** As the table writes it, 1.0 + 0.2
>    capped at 1 is 1.0 with or without contexts, so the bonus cannot change a score. Making it count would mean a base
>    below 1, a number nothing here supports.
> 3. **Agreement counts distinct relation kinds, not generators:** distinct `RelationEdge.kind` values, minus 1. So similar
>    articles and the recommender agree, and Semantic Scholar's and Europe PMC's citation lists do not. Two lists of one kind
>    report one fact from two indexes, not two judgements, and which of them ran depends on the budget and the cache
>    (§6.1's note, item 2), so counting them would let a paper's score move with what the run could afford. There are four
>    kinds, so agreement never passes 3 and the cap never bites; it stays as this section writes it.
> 4. **`pmraScore` is `RelationEdge.score` as it arrives.** `rankElinkLinkset` has already divided by the list's maximum. A
>    score that is absent or not a number is 0.
> 5. **`recScore` uses the edge's own asked `limit`,** takes the work's best edge, and is 0 for a rank past the limit, never
>    negative.
> 6. **The `cosine` term is what the injected `SimilarityFn` returns, read as a value already in [0, 1].** `P5-T14` applies
>    `(cosine + 1) / 2` to SPECTER2 only; §5.5 item 6 forbids it on the lexical space. A value outside [0, 1] is clipped and
>    one that is not a number is 0. **So a score is not comparable across the two spaces:** a cosine of 0 reads 0.5 once
>    rescaled and 0 on the lexical space, and a run without a key has no recommendation term at all.
> 7. **`ageYears` counts calendar years,** `window.toYear − publishedDate.year`, floored at 0, because a `PartialDate` may hold a
>    year alone and the window is calendar years (`docs/08` §4.2). `onlineDate` is not a fallback, as in `applyClientRecencyFilter`.
> 8. **`outsideWindow` means older than `window.fromYear` (FR-18's "older candidates").** A work dated after `window.toYear`,
>    such as next year's issue seen in November, is not flagged: it is new, not old, and greying it would serve nothing
>    FR-18 asks for. A work with no date has `recency` 0, is not flagged and stays ticked, as `applyClientRecencyFilter`
>    keeps one and counts it: nothing shows that it is old.
> 9. **Rows come back ranked, highest score first; a tie keeps the generators' union order,** so the best generator's records
>    lead.
> 10. **Chips are ids, in a fixed order whatever the edges' order:** `cites-seed` (`citation`), `cited-by-seed` (`reference`),
>     `recommended`, `similar-pubmed` (`similar`), then `similar`, carrying the value, then `citation-context`, carrying the
>     text. `similar` is the similarity term, on any row where it is above 0. **It has no threshold,** because §5.5 records that a
>     threshold set on one space means nothing on the other; the window shows the number, as §6.3's "similarity 0.81" does.
>     `citation-context` is the first non-blank context of the lowest-ranked edge holding one, ties going to the generator id.
>
> **FR-18 is split.** This card computes the flag and states the rule (`isCheckedByDefault`: not in the library and not
> outside the window). `plan/08` `P5-T14` passes `recencyWindow(searchYears, clock)` in, from the preference, not from the
> window's year lists. `P5-T16` draws the row greyed and unticked.

### 6.3 Presentation

Show **why** each item was recommended — this is the difference between a tool users trust and one
they abandon:

> **scRep: A Latent-Space Self-Distilled Foundation Model…** (bioRxiv, 2026)
> *Cites your paper* · *Recommended by Semantic Scholar* · similarity 0.81
> Cited as: "…including scBERT [44], **Geneformer [39]**, scGPT [8]…"

Let the user check items and add only those. Never auto-add — a wrong bulk import into someone's
library is worse than no feature.

---

## 7. Feature 6 — recommend from a collection

Given a whole Zotero collection, produce papers the user does not have and would want.

### 7.1 Overview

```
┌─ 1. PROFILE ──────────────────────────────────────────────┐
│  Read collection → canonical records                      │
│  Extract: MeSH/keyword frequencies, authors, venues,      │
│           seed DOIs, centroid embedding(s), date span     │
└───────────────────────────────────────────────────────────┘
                          ↓
┌─ 2. GENERATE ─────────────────────────────────────────────┐
│  a. S2 Recommendations POST (positives = top seeds)       │
│  b. PubMed elink pmra over PMID seeds                     │
│  c. S2 citations of seeds (who cites my collection?)      │
│  d. Keyword search from top profile terms (doc 02 §12)    │
│  e. Author/venue watch                                    │
└───────────────────────────────────────────────────────────┘
                          ↓
┌─ 3. FILTER ── already-owned · date window · type · dismissed
                          ↓
┌─ 4. SCORE ──── similarity · recency · velocity · novelty · quality
                          ↓
┌─ 5. PRESENT ── ranked, explained, checkbox-selectable
```

### 7.2 Step 1 — build the collection profile

> **Naming.** `CollectionProfile` is the **persisted** record declared in
> `07-architecture-and-data-model.md` §5.2 and stored in the `collection_profile` table (§8.3);
> doc 07 owns that type. The structure below is this pipeline's **in-memory working set** — it holds
> `Float32Array` centroids, a `Map`-of-`Set` reference index and library-wide owned-ID sets, none of
> which are persisted in that shape — so it is a distinct type with a distinct name,
> `CollectionProfileDraft`. Doc 07's record is derived from it.
>
> **Centroids round-trip.** The draft below carries `centroids` — *k* of them, for the multi-topic
> case handled later in this section — and doc 07 §5.2's persisted record now carries
> `centroids: number[][]` (empty when embeddings are unavailable) to match, stored as a k × dim
> Float32 blob in `collection_profile.centroids` (doc 07 §8.3). The two differ only in
> representation: `Float32Array` here, hydrated `number[]` there. A collection spanning several
> subfields is the *normal* case for feature F6, so persisting only a primary centroid would
> silently degrade recommendations for exactly the collections this feature exists to serve.

```ts
interface CollectionProfileDraft {
  collectionKey: string;
  size: number;

  /** Top MeSH descriptors by frequency, IDF-weighted against the whole library. */
  meshTerms:  Array<{ term: string; ui?: string; count: number; weight: number }>;
  /** Author keywords + title n-grams, same weighting. */
  keywords:   Array<{ term: string; count: number; weight: number }>;
  /** Authors appearing ≥ 2 times, plus every last author (PI signal). */
  authors:    Array<{ name: string; orcid?: string; count: number }>;
  venues:     Array<{ name: string; issn?: string; count: number }>;

  /** Highest-signal seeds for the Recommendations API. */
  seedIds:    string[];          // 10–20, prefixed ('DOI:…','PMID:…')

  /** One centroid, or k centroids if the collection is multi-topic. */
  centroids:  Array<{ vector: Float32Array; members: string[]; label?: string }>;
  embeddingModel: string;

  dateSpan:   { min: string; max: string };
  /** Reference DOIs of collection members — free bibliographic coupling (§2.3). */
  refIndex:   Map<string, Set<string>>;
  /** Everything the user already has, library-wide (not just this collection). */
  owned:      { doi: Set<string>; pmid: Set<string>; arxiv: Set<string>; titles: Map<string, number[]> };
}
```

#### Term weighting

Raw frequency over-weights boilerplate MeSH (`Humans`, `Animals`, `Male`, `Female` appear on
everything). Weight each term by its frequency **in the collection** against its frequency **in the
user's whole library**:

```ts
weight(term) = (countInCollection / collectionSize)
             * Math.log(1 + librarySize / (1 + countInLibrary));
```

Also hard-exclude the MeSH check-tag list (`Humans`, `Animals`, `Male`, `Female`, `Adult`, `Aged`,
`Child`, `Mice`, `Rats`, …) — they are indexing artefacts, not topics. Prefer MeSH terms marked
`MajorTopicYN="Y"` (doc 02 §3.4), which are already the curator's judgement of what a paper is
*about*.

> **As built 2026-11-02 (`plan/08` `P5-T18`; `buildProfileStats` in `src/pipeline/recommend/profile.ts`, constructed by nothing, called by `recommendPipeline.ts`, `P5-T25`).** The formula above is the one built, counted per item: a term on an item counts once however many tags or title words carry it.
>
> **Measured 2026-11-02, the recorded PubMed answers in `test/fixtures/pubmed/` (232 article entries, 206 distinct PMIDs, 503 distinct descriptors):** the five most frequent descriptors are `Humans` 87, `Female` 34, `CRISPR-Cas Systems` 34, `Gene Editing` 33, `Animals` 32, and 13 of the 36 most frequent descriptors are on the list below. The list is what removes them, not the formula: in a 30-item library that is the collection, the formula alone gives a term on every item `ln(1 + 30 / 31)`, about 0.68, above a term on two thirds of the items, about 0.59 (`P5-T18`'s tests hold both cases). The scale measured, in Node on synthetic rows: 10 000 library rows of a 12-word title and 25 tags against a 500-item collection took `buildProfileStats` 232 to 265 ms over 3 runs, synchronously, for about 13 KB of stored JSON. `P5-T30` measures it on the owner's library.
>
> **DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313):**
> 1. **The check-tag list this section leaves open with "…"** is `CHECK_TAGS` in `profile.ts`: `Humans`, `Animals`, `Male`, `Female`, `Infant`, `Infant, Newborn`, `Child`, `Child, Preschool`, `Adolescent`, `Young Adult`, `Adult`, `Middle Aged`, `Aged`, `Aged, 80 and over`, `Pregnancy`, `Mice`, `Rats`, `Cats`, `Cattle`, `Chick Embryo`, `Cricetinae`, `Dogs`, `Guinea Pigs`, `Horses`, `Rabbits`, `Sheep`, `Swine`, and the nine period tags `History, Ancient`, `History, Medieval` and `History, 15th Century` to `History, 21st Century`. **Compared 2026-11-02 (`plan/reports/check-tags-nlm.md`):** NLM publishes no single current list that the comparison could find, and three NLM sources disagree: a course page last reviewed in 2017 (33 terms), a 2023 research report (40) and a list derived from the 2026 MeSH annotations (32). The 27 terms first written here are all on the 2023 report, and the nine period tags are on all three. **DECIDED 2026-11-02 (coordinator, under `plan/00` §6 item 313):** the nine are added; `Cattle`, `Horses`, `Sheep` and `Swine` stay although not every source has them; `Bees`, `Chlorocebus aethiops`, `History of Medicine` and `United States`, on the 2023 report only, are not added. It applies to keywords and title words as well as to MeSH, because an item saved by Zotero's own PubMed translator carries its descriptors as bare tags (not measured here; `P5-T30` sees it on the owner's library).
> 2. **"Prefer major-topic MeSH"** multiplies the weight by `1 + 0.5 × (items where it is major) / (items that have it)`. So the formula is exact for a term that is never major, and a term major on every item weighs 1.5 times as much. The factor is a starting value, unmeasured.
> 3. **Title n-grams** are single words and adjacent pairs of `normalizeTitle`'s tokens, a stop word or a one-character or all-digit token breaking the pair (`TITLE_STOP_WORDS`). A term known only from titles needs at least 2 items in the collection, so one paper's wording is not a topic, and a single word known only from titles is dropped when a kept multi-word term holds it. Measured 2026-11-02 on 39 CRISPR papers of those fixtures against the 206, tags stripped: the top five were `editing`, `crispr`, `base`, `genome`, `cas9` before that rule and `crispr cas9`, `genome editing`, `gene editing`, `base editing`, `base editor` after it. The library is counted the same way, which is why the library pass reads titles as well as tags.
> 4. **Term identity is `normalizeTitle`,** so `CRISPR-Cas Systems`, `crispr cas systems` and the title pair "crispr cas" are told apart by words only. `termWeights` is keyed by the most frequent tag spelling (ties: the smaller in code-unit order), or by the normalised form, recomposed to NFC so Hangul stays readable, for a term known only from titles.
> 5. **The stored lists are capped:** 100 terms in `termWeights`, 100 entries in `subjectCounts`, 10 venues (§7.4's "top-10"). `topAuthors` is not capped, because this section's rule already bounds it. `subjectCounts` holds MeSH without the check tags, plus arXiv categories; an arXiv category is not a term, because `cs.LG` is not a search query.
> 6. **Author identity** is `Family Initials`, the form §7.3's `AUTH:"Doudna J"` writes, with a single-field name kept whole. All the initials count, so `Kim J` and `Kim JH` stay two people: a false merge is the expensive error (`R-18`), and Korean family names are few. Ranked by items, then items as last author, then name.
> 7. **Every regular item counts,** not only `type !== "other"` as §7.5's sketch filters: FR-44 says "≥5 items", `membershipHash` covers them all, and a paper whose type could not be determined is `other` (FR-7 scenario 3).
> 8. **A tag the user typed is not a keyword** (`topicTagNames` in `src/zotero/itemMapper.ts`): this section asks for author keywords, `09-security-privacy-and-api-keys.md` §3 row 6 lists tags among what is not sent, and these terms become search queries (§7.3 row d). Only automatic tags count, plus a manual tag spelled `MeSH:` or `arXiv:`. The owner is asked to confirm this in `plan/reports/P5-T18.md`.
>
> **Measured 2026-11-02 in Zotero 10.0.3 (`test/integration/zotero/recommendLibrary.spec.ts`, which was only type-checked before this date):** one fixture item carried four tags, and only the manual one not spelled as a subject was left out. An automatic tag stayed a keyword, a manual `MeSH*: Gene Editing` became a major `mesh` subject, and an automatic `arXiv: cs.LG` became an `arxiv-category` subject. `getTags()` returned the tags in name order in every run, and the spec sorts them before comparing. `item.dateAdded` and `item.dateModified` both read `2026-11-02 06:14:25`, the `YYYY-MM-DD HH:MM:SS` shape `zoteroDateToEpochMs` parses, and read as UTC it fell within an hour of the run's clock on a computer nine hours ahead of UTC, so the stored value is UTC and not local time. `libraryTermSources` ran one `Zotero.Search`, on a library of two regular items: 1 to 28 milliseconds across six runs, so its cost on a large real library is still unmeasured in Zotero. The trashed item and the note in the fixture have no row.

#### Seed selection — the highest-leverage decision in the feature

The Recommendations API takes a bounded number of positives (§3.3), so choosing them matters more
than any weight in the scoring formula.

*As built 2026-11-02 (`plan/08` `P5-T18`): `addedAtByWorkKey` in `src/pipeline/recommend/profile.ts` is the `addedAt` below, from `ZoteroItemSnapshot.dateAdded` through `readCollectionWorks`. An item whose date cannot be read has no entry, which the sketch's `?? 0` already handles. Caller: `seeds.ts`, `P5-T21`.*

```ts
/**
 * `addedAt` is supplied by the collection loader (Zotero item `dateAdded`); it is NOT part of
 * CanonicalRecord (doc 02 §10.1), so it must be passed in explicitly — reading it off the record
 * would silently evaluate to `undefined` and zero out a 0.20-weight term.
 * `emb(r)` returns the L2-normalised Float32Array for `r` from the embedding cache (§5.2).
 */
function selectSeeds(
  records: CanonicalRecord[],
  addedAt: Map<string, number>,                   // record key -> epoch ms
  emb: (r: CanonicalRecord) => Float32Array,
  k = 15,
): string[] {
  const ninetyDaysAgo = Date.now() - 90 * 864e5;
  const scored = records.map(r => ({
    r,
    s: 0.40 * recencyScore(r.dates.year)          // recent = current interest
     + 0.25 * centralityScore(r)                  // close to a centroid, not an outlier
     + 0.20 * ((addedAt.get(r.key) ?? 0) > ninetyDaysAgo ? 1 : 0)   // added in the last 90 days
     + 0.15 * qualityScore(r.metrics.citationCount),
  })).sort((a, b) => b.s - a.s);

  // Diversify: greedily skip a candidate too close to one already chosen,
  // so a 3-topic collection doesn't send 15 seeds from one topic.
  const chosen: CanonicalRecord[] = [];
  for (const { r } of scored) {
    if (chosen.length >= k) break;
    if (chosen.every(c => cosine(emb(c), emb(r)) < 0.92)) chosen.push(r);
  }
  return chosen.map(toPrefixedId);              // 'DOI:…' | 'PMID:…' | 'ARXIV:…'
}
```

**Negative examples.** `POST /papers/` accepts `negativePaperIds`, and this is the plugin's most
under-appreciated lever. Populate it from **papers the user explicitly dismissed** in previous runs.
That turns feature 6 from a stateless query into something that learns — cheaply, locally, with no
model training.

```ts
negativePaperIds: dismissedStore.recent(10).map(toPrefixedId)
```

Persist dismissals in the plugin's own SQLite table, never in the Zotero item data.

#### Multi-topic collections

A single centroid is wrong for a collection spanning several subjects — it lands in empty space
between clusters and recommends things related to nothing. Detect and split:

```ts
// Cheap: k-means with k = 1..4, pick k by silhouette; bail to k=1 if the gain is small.
const centroids = kmeansAuto(vectors, { kMax: 4, minClusterSize: 5, minGain: 0.08 });
```
Then run generation **per cluster** and interleave results, labelling each group. This also produces
a better UI ("Related to your *base editing* papers" / "Related to your *delivery vectors* papers")
than one undifferentiated list.

> **As built 2026-11-05 (`plan/08` `P5-T21`; `kmeansAuto` and `labelCentroids` in `src/pipeline/recommend/centroids.ts`, `selectSeeds`, `recentNegatives` and `withTopicsAndSeeds` in `src/pipeline/recommend/seeds.ts`; caller of each: `recommendPipeline.ts`, `P5-T25`, built 2026-11-05).** Nothing here has seen a real SPECTER2 vector: the tests use synthetic ones. Local only: nothing is sent.
>
> **Starting values with no measurement behind them on real vectors:** `kMax: 4`, `minClusterSize: 5` and `minGain: 0.08` above, the cut of 0.92 in `selectSeeds`, and the four seed weights. `P5-T30` measures them, because it is the first run with real vectors for a whole collection: `withTopicsAndSeeds` logs each k tried with its silhouette and smallest cluster, counts only. `P5-T31` records two papers, which cannot show them.
>
> **What the synthetic vectors show, and only about the mechanism.** 768 values, unit topic centres at random, each member a centre plus Gaussian noise, 10 data seeds per row, default options. "Noise" is the noise vector's length against the centre's length of 1. At noise 0.83 and 1.2, one topic of 40 or 100 stayed k = 1 on all 10 (highest silhouette of any k tried 0.012), two topics of 20 and 20, and of 30 and 10, gave k = 2 on all 10, and 3 × 15 gave k = 3 on all 10. Four topics of 15, 12, 10 and 8 gave k = 4 on all 10 at noise 0.83 and on 5 of 10 at noise 1.2, with k = 3 on the rest. At noise 3.0, where their highest silhouette is about 0.09, the same four topics gave k = 4 on 3 of 10 and k = 1 on 7, so **`minGain` decides the answer once silhouettes come near it**, and how high real SPECTER2 silhouettes run is the unknown. Time under Node, not inside Zotero, one run each on two topics: `kmeansAuto` took 10 ms at 100 members, 48 ms at 300, 149 ms at 600, 162 ms at 1 000 and 184 ms at 5 000, and the whole of `withTopicsAndSeeds`, with no term weights to label from, took 11, 48, 152, 158 and 192 ms on those sizes. On the lexical space `lexicalSeedSpace` and `selectSeeds` together took 33 ms on 156 abstracts.
>
> **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313):**
> 1. **A run with at least one vector for a member is on SPECTER2; a run with none is on the lexical space** and has no centroids, no labels and no `embeddingModel`. So a keyed run whose fetch failed outright does not store a profile that later reads as fresh for a keyed run (`docs/07` §12.5). One space per run holds (`plan/08` §0.2 item 22): a member with no vector on SPECTER2 is never compared in words.
> 2. **"Gain" is measured against the k before it.** A k = 1 has no silhouette, so it counts as 0. Going through k = 2 to `kMax`, a k is taken when every cluster has `minClusterSize` members and its silhouette beats the k held so far by at least `minGain`. When the silhouettes of two k are close, the smaller wins, because each topic costs one request (`P5-T23`).
> 3. **The k-means is spherical, because the vectors are unit length:** a member goes to the centroid of highest cosine, a centroid is the normalised mean, and the silhouette uses `1 − cosine`. Initialisation is k-means++ from a seeded generator (`KMEANS_SEED`), 3 restarts, keeping the highest total cosine, at most 50 passes. Members are sorted by work key first, so input order changes nothing. Topics are numbered largest first, then by first work key, and `topicIndex` points at that order.
> 4. **The fit and the silhouette read at most 600 members, a seeded sample of larger collections,** and every member is then assigned, so `minClusterSize` is checked on all of them. 600 keeps the pairwise table small; it is a starting value chosen for time on the main thread (timings below), not for quality.
> 5. **The sketch's three undefined scores.** `recencyScore` is §7.4's decay at τ = 1.5 over whole years from the publication year, 0 with no year. `qualityScore` is `min(1, ln(1 + citations) / ln(1 + 1000))`, 0 with no count; the 1000 is a starting value, and §7.4's velocity is not reused because a seed's worth is not its age. `centralityScore` is the cosine with the member's own centroid, or on the lexical space with the mean of the collection's word vectors, which is held for this pass and never stored, then stretched so the collection's lowest reads 0 and its highest 1. Raw cosines sit in a narrow band, and without the stretch the 0.25 weight would not act. A member with no vector scores 0.
> 6. **Seeds are taken in turn from each topic, best first,** not in one score order. The sketch's comment wants 3 topics not to send 15 seeds from one, and a cut alone cannot do that: two papers of one topic rarely reach 0.92. `P5-T23` sends one request per topic, so a topic with no seed would go unasked. `seeds` holds the order they were taken in, so its first 10 (generator (b)) still cross the topics. A member with no vector, and so no topic, is taken only after the topics run out.
> 7. **The cut on the lexical space is 0.45 (`LEXICAL_DIVERSITY_CUT`),** because §5.5's scores are on another scale. Measured 2026-11-05 on the recorded PubMed abstracts in `test/fixtures/pubmed/`, the 142 of the six files holding at least 15, with the collection as the corpus: over all 10 011 pairs of different papers the median is 0.037, the 99th percentile 0.242 and the highest 0.361; within one file at most 0.317. One paper against a copy of itself reads at least 0.494 with half its abstract's words replaced (0.876 with a tenth replaced), and at least 0.515 with no abstract on one side. So 0.45 sits between the two, and it stops two versions of one paper and nothing else. **It does not spread topics:** ranked by year alone, the 15 seeds of those 142 abstracts all came from one file at every cut from 0.15 to 0.92, and the built `selectSeeds` over `lexicalSeedSpace` did the same on the 156 abstracts of the seven files holding at least 14, 15 of 15 from one file. A cut cannot do it on this space, and a run with no key has no centroids to take turns between. Synthetic copies are not real preprint and published pairs, and `P5-T30` sees real ones.
> 8. **Below 10 seeds, skipped papers come back** in score order until there are 10 or none is left, because 10 is `plan/08` `P5-T21`'s floor and the 0.92 is unmeasured on real vectors. The ceiling is `RECOMMEND_MAX_POSITIVES`, read and not copied, so `P5-T29`'s figure reaches this code. A member with no identifier Semantic Scholar's request could carry (`toSemanticScholarId`) is never a seed.
> 9. **A centroid's label is its members' highest-weighted term that tells it from the other topics:** `rankedTerms` weight × (share of its members holding the term − share of the other members holding it), the best not already used by a larger topic. A member holds a term when it is one of its MeSH subjects or keywords, or runs in its title, each through `normalizeTitle`. No model is called. If any topic has no such term, `centroidLabels` is left out and the window numbers the groups (`docs/07` §5.2). The labels are worked out from the terms as built, so a term the user removes later stays on a label until the next rebuild.
> 10. **Negatives** are `recentNegatives`: `listRejected(profileId, 10)`, read on each run and never on the profile, identifiers only, leaving out a row with no identifier. A store that cannot be read warns and answers none: `P5-T24`'s filter reads the store for itself, and a run without negatives is still a good run.

### 7.3 Step 2 — candidate generation

| Generator | Call | Requests | Yields |
|---|---|---|---|
| **a. S2 Recommendations** | `POST /papers/` with 15 positives + 10 negatives, `limit=200` | 1 | 200 |
| **b. pmra** | `elink&cmd=neighbor_score` per PMID seed (≤10 seeds) | ≤10 (fast host) | 500–2000 |
| **c. Forward citations** | `/paper/batch` refs, then `/citations` on the top 10 seeds | ~11 | 300–1000 |
| **d. Keyword search** | Top 5 profile terms → the selected sources (FR-45), last 3 years | 2–4 | 200 |
| **e. Author/venue watch** | Europe PMC `AUTH:"…" AND FIRST_PDATE:[…]` for top 5 authors | 1 (OR-combined) | 50–200 |

*Corrected 2026-11-02 (`plan/reports/phase5-review.md`; `plan/08` `P5-T23`): row d read "Europe PMC + arXiv", but FR-45 says "the selected sources". A run without a Semantic Scholar key drops Semantic Scholar from that list (owner, `plan/00` §6 item 320(a)). The per-host budget below and `genKeywordSearch`'s host comment in §7.5 were worked out on the old row.*

**Budget, per host:** ~15 S2-host requests (**~15 s**), ~10 NCBI requests (~1–3 s), ~5 Europe PMC
requests (~1 s), plus 3 arXiv requests (**9 s**, forced by the 3-second rule).

**These do not add up — the hosts run concurrently** (§9.4), so *generation* costs the slowest
queue, **≈ 15 s**, not the 28 s sum. The rest of a full feature-6 run is what follows generation:
hydrating survivors and fetching any uncached embeddings, both of which queue behind the same
Semantic Scholar 1 req/s limiter. **Budget ≈ 15 s of generation + ~10 s of hydration/embedding
≈ 25–30 s end to end** on a cold cache, and only a few seconds when the cache is warm. That is a
"click a button, watch a progress bar, get a good list" feature — not a type-and-wait one. Design
the UX accordingly and cache hard (§9).

Generator (e) deserves emphasis: **"my favourite authors published something new" is often the
single most valued recommendation type**, it is nearly free, and it is completely independent of the
ML stack. Combine authors with OR into one Europe PMC query:

```
(AUTH:"Doudna J" OR AUTH:"Liu DR" OR AUTH:"Zhang F") AND (FIRST_PDATE:[2026-06-08 TO 2026-09-08])
```

> **As built 2026-11-05 (`plan/08` `P5-T23`; `runRecommendGenerators` and `recommendKeywordQueries` in `src/pipeline/recommend/generators.ts`; caller of both: `recommendPipeline.ts`, `P5-T25`, built 2026-11-05).** Every figure below is a starting value or arithmetic on one; nothing here has met a live service, and Semantic Scholar's part rests on hand-written stand-ins (`plan/00` §6 item 335(a)). **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313):**
>
> 1. **Budget.** `RECOMMEND_REQUEST_BUDGET` is 40 (§9.3's sketch), spent in `GENERATOR_VALUE_ORDER`. All planning finishes before the first request, so the order decides who gets the budget, not which host answers first. A cached answer costs nothing. Keyword search, forward citations and arXiv must leave `RECOMMEND_HYDRATION_RESERVE`, 2 requests, because `P5-T25` hands the same budget to the metadata fill-in and §6.1's `limit=200` brings no abstracts: §9.1 item 2's "~200" survivors at 100 identifiers a request is 2.
> 2. **What each generator is charged, before it starts.** (a) 3 per topic group: one `/paper/batch`, one POST, and the one retry a too-large answer can cost. (b) 1 `elink` plus one `efetch` per 200 neighbours it could list (`EFETCH_MAX_IDS_PER_CALL`), so 6 for 10 seeds at limit 100; a short budget takes fewer seeds. (c) 1 per seed on Semantic Scholar; on Europe PMC 1 with a PMID or PMCID and 2 with a DOI alone. (d) 2 per query on PubMed (`esearch`, `efetch`), 1 elsewhere. (e) 1.
> 3. **What that buys.** Worked out from item 2, for a keyed run with the default `sources` and three queries: one topic spends 3 + 6 + 1 + 15 + 10 + 3 = 38 of 40, which leaves exactly the reserve. Four topics spend 12 + 6 + 1 + 15 = 34, then 4 seeds of (c), and arXiv gets nothing. **A budget of 12** runs (a) and (b) in full for up to two topics (one topic 3 + 6, two topics 6 + 6) and not for more; (e) and (d) rank above (c) in §9.3, so (c) gets a seed only when those two ask for little.
> 4. **Topic groups.** With more than one centroid, (a) sends one request per `topicIndex`, lowest first, at most `RECOMMEND_MAX_TOPIC_REQUESTS` (4), each with that group's seeds and the same negatives. A seed with no `topicIndex` is left out of (a) on such a profile and still serves (b) and (c). With k ≤ 1 there is one request over every seed and no group is recorded, matching `docs/07` §5.2's `topicIndex`, "absent when the profile has k ≤ 1". Each request asks for 200.
> 5. **Identifiers.** `semanticScholarIdsOf` is applied to positives, negatives and (c)'s seeds, so an arXiv `10.48550/arXiv.…` DOI goes out as the arXiv id (`plan/00` §6 item 337(c)). At most 10 negatives go out (`MAX_NEGATIVES`).
> 6. **Limits and shared cache.** (b) and (c) ask 100 per seed, with `docs/07` §9.2's keys spelt as `P5-T12` spells them, so a related run and a recommend run share those entries; (c) takes the first 10 seeds it can ask. (c) sends no `fromDate`, and neither does (b): `P5-T24`'s `identifierFilters` applies the window.
> 7. **Queries (`recommendKeywordQueries`).** `suggestedQueries` when `origin` is `"llm"`, at most `RECOMMEND_MAX_KEYWORD_QUERIES` (3), one query each, because each is a term or phrase (`docs/12` §15). Otherwise one query, the top 5 of `rankedTerms` as quoted phrases joined by `OR`, because §7.3's row counts 2–4 requests and five terms joined by `AND` would rarely match. `userEdits` apply at this point: a suggested query holding a removed term as whole words is dropped, a removed term leaves the list, and added terms come first (on the LLM path as one `OR` query of their own). An LLM profile left with no query falls back to the terms. Each source gets 50 records per query.
> 8. **`fanOut` is called once per source and query,** because it has no cache hook, serial per host. A source with `keywordSearch: false` is not asked, and neither is `openalex`. A keyword answer is cached for §9.2's 1 day, unless it failed or was empty with a warning. The caller resolves `sources` and `searchYears` and passes them in, as `SearchImportInput` does. The key probe it passes is `SemanticScholarSource.hasUsableApiKey` (`plan/00` §6 item 339(b)), because Semantic Scholar's search path sends without a key and this run must not.
> 9. **(e)** goes through the Europe PMC adapter's `search` with a built query tree, not through `parseUserQuery`, so a name cannot change the query's shape. The 90 days are counted in UTC from the clock. Only (d) reads `sources`; (a), (b), (c) and (e) go to their own hosts whatever it holds, as `P5-T12`'s generators do.
> 10. **A host that answers `RateLimitError` is left alone for the rest of the run:** the client's retries are already spent, and §9.5 warns against firing the queued requests behind it. Its remaining requests read `rate-limited` and are not sent. The budget they took is not returned.
> 11. **(c) has no second wave.** A keyed run whose Semantic Scholar fails does not then ask Europe PMC for citations, though §9.5's ladder reads that way: (b), (d) and (e) still run, and `P5-T30` can show whether it matters.
> 12. **What comes out.** `candidates`, each a `MergedWork` with `discoveredVia`, one entry per list that found it, with `topicGroup` on (a)'s; five `statuses`, ids and codes only; `state`, §12.5's `Generating` edge in `docs/07`; `links` and `flags`. Nothing is filled in or filtered here (`docs/05` §9.1 item 2).

### 7.4 Step 4 — scoring

```
score(c) = w_sim  · similarity(c, profile)
         + w_rec  · recency(c)
         + w_vel  · velocity(c)
         + w_nov  · novelty(c, profile)
         + w_auth · authorAffinity(c, profile)
         + w_ven  · venueAffinity(c, profile)
         + w_gen  · generatorAgreement(c)
         + w_coup · coupling(c, profile)
```

| Term | Formula | Notes |
|---|---|---|
| `similarity` | `max over centroids of ((cosine + 1) / 2)` | Max, **not mean** — mean punishes papers that fit one sub-topic perfectly |
| `recency` | `exp(−ageDays / 365 / τ)`, τ = 1.5 | Hard-filter anything outside the 3-year window first |
| `velocity` | `min(1, citationCount / max(0.25, ageYears) / 20)` | Citations **per year**, so a 2026 paper with 5 citations beats a 2023 paper with 12 |
| `novelty` | `1 − max over p in collection of ((cosine(c, p) + 1) / 2)` | **Rewards distance** from what the user already has. Note the `(x+1)/2` rescale: cosine is in [-1,1], so the bare `1 − cosine` used elsewhere would range over [0,2] and silently out-weigh every other term |
| `authorAffinity` | `min(1, 0.5 × (# profile authors on c))` | |
| `venueAffinity` | `1` if venue in profile top-10, else `0.3` if same ISSN family | |
| `generatorAgreement` | `min(1, (generators − 1) / 3)` | |
| `coupling` | normalised shared references with collection (§2.3) | Free once refs are cached |

**Starting weights:**

```
w_sim  = 0.30   w_rec  = 0.15   w_vel  = 0.10   w_nov  = 0.10
w_auth = 0.10   w_ven  = 0.05   w_gen  = 0.12   w_coup = 0.08
```

#### The similarity/novelty tension — get this right or the feature is useless

`similarity` and `novelty` **pull in opposite directions by construction**, and that is deliberate.
Pure similarity returns papers the user has essentially already read; pure novelty returns noise.
The blend above (0.30 / 0.10) leans toward relevance while reserving room for discovery.

Rather than shipping one fixed blend, expose a single user-facing slider — **"Familiar ←→
Exploratory"** — mapped onto the pair:

```ts
// t ∈ [0,1], default 0.25 → w_sim = 0.30, w_nov = 0.10 (the starting weights above)
w_sim = 0.40 - 0.40 * t;
w_nov = 0.40 * t;
```

One slider, two weights, immediately intelligible. Everything else stays fixed.

Two invariants the slider must preserve, and which an earlier draft of these formulas broke:

1. **`t` at its default must reproduce the starting weights.** `t = 0.25` gives exactly
   `w_sim = 0.30` and `w_nov = 0.10`.
2. **`w_sim + w_nov` is constant at 0.40** for every `t`, so the eight weights keep summing to
   **1.00** and scores stay comparable across slider positions. A slider whose endpoints change the
   total makes "score 0.62" mean different things at different settings, which breaks the
   held-out evaluation in §8 as well as the UI.

#### Hard filters (applied before scoring, not as score penalties)

```ts
candidates = candidates.filter(c =>
     !profile.owned.doi.has(c.ids.doi ?? '')
  && !profile.owned.pmid.has(c.ids.pmid ?? '')
  && !profile.owned.arxiv.has(c.ids.arxivId ?? '')
  && !fuzzyOwned(c, profile.owned.titles)          // doc 02 §11.3.3
  && !dismissedStore.has(c.key)
  && inDateWindow(c, profile)
  && (settings.includePreprints || c.type !== 'preprint')
  && (c.abstract != null || c.tldr != null)        // no abstract → nothing to summarize
);
```

Note the last filter: feature 3 needs an abstract. A recommendation the summarizer cannot process is
not a useful recommendation.

Also drop **preprints whose published version the user already owns** — the `linkedVersion`
resolution from doc 02 §11.4 makes this a lookup, not a guess. This is a common and irritating
false positive.

*Corrected 2026-11-05 (`plan/08` `P5-T24`; FR-46, settled by the review of 2026-11-01): the sketch above drops too much. `profile.owned` there means the whole library, and FR-46 excludes only the source collection: a library item outside it stays, marked "in library" and unticked (`docs/07` §5.2's note of 2026-11-02, items 2 and 3). `profile.owned.titles` was never built, `settings.includePreprints` is not a setting (a preprint stays and is labelled, unless the run's "Peer-reviewed only" box is ticked, `plan/08` §0.4 line 24), and `c.tldr` does not exist: `CanonicalWork` has no such member, and the Semantic Scholar mapper puts a tldr in `abstract` when the abstract is missing, so reading `abstract` reads both. The filters run in two passes, as §7.5's note says.*

> **As built 2026-11-05 (`plan/08` `P5-T24`; `recommendationWeights`, `recommendOwnership`, `readDismissed`, `identifierFilters`, `contentFilters`, `scoreRecommendations` and `diversify` in `src/pipeline/recommend/score.ts`; caller of each: `recommendPipeline.ts`, `P5-T25`, built 2026-11-05).** Nothing here has seen a real SPECTER2 vector or a live service: the SPECTER2 tests use hand-made vectors, and the fixture run in `test/unit/pipeline/recommendScore.test.ts` is on the word space.
>
> **Starting values with no measurement behind them:** the eight weights and the slider's 0.40, τ = 1.5, the velocity figures 20 and 0.25, the steps 0.5 and 0.3, the agreement span of 3, the caps 2 and 4, λ = 0.75 and the top K of 30. **What would measure them is §8.1–§8.2's held-out precision@k and ablation, which are backlog (`plan/00` §6 item 323(d)), so nothing in Phase 5 measures them.** `G-27` is the expert judgement, `P5-T30` the first run with real vectors.
>
> **DECIDED 2026-11-05 (coordinator, under `plan/00` §6 item 313):**
> 1. **On the word space, similarity reads the whole collection and novelty the nearest member,** so the two stay two terms. Similarity is the dot product with the collection's mean word vector at unit length, novelty is `1 − highest cosine over the members`, and neither takes `(x + 1) / 2`, because §5.5's scores are in [0, 1] already. The alternative, the highest cosine for both, makes novelty exactly `1 − similarity`. **Measured 2026-11-05** on the recorded PubMed abstracts in `test/fixtures/pubmed/`, the 184 abstracts, using the seven files holding at least 14: 8 runs whose collection was the first half of one file or of two, with every other abstract as a candidate, scoring `w_sim · similarity + w_nov · novelty` alone and counting how many of the top 30 stayed against `t` = 0.25. **With the highest cosine for both:** `t` = 0 kept 30 of 30 on all 8, `t` = 0.5 kept 14, 12, 7, 8, 9, 2, 10 and 14, and `t` = 0.75 and 1 kept none, so the slider had two positions. **As built:** `t` = 0 kept 29, 29, 26, 26, 25, 28, 23 and 29, `t` = 0.5 kept 23, 20, 21, 19, 17, 28, 21 and 15, `t` = 0.75 kept 0, 0, 2, 0, 0, 0, 4 and 0, and `t` = 1 kept none. Similarity's 10th, 50th and 90th percentiles ran about 0.08–0.11, 0.11–0.15 and 0.17–0.25, novelty's about 0.81–0.87, 0.90–0.91 and 0.93–0.94, and the correlation of the built similarity with the highest cosine was 0.62 to 0.97. One small sample, "another file" stands in for "another topic", and no person judged a list. Item 15 holds the same slider on whole scores.
> 2. **The profile decides the space:** centroids mean SPECTER2, none means the word space, as §7.2's note, item 1, builds it. A keyed run whose vectors all failed scores in words and says so in `similaritySpace`, and vectors on hand are then unread.
> 3. **A candidate with no vector on SPECTER2, or no text on the word space, reads 0 on similarity and on novelty,** because it gives no evidence either way (`docs/07` §5.2: 0 when a run cannot compute it). Reading 1 on novelty would reward a missing vector. A member with no vector is left out of novelty, and with no such member at all novelty is 0. `cosine`'s throw on two models or two lengths goes through as a defect.
> 4. **`fuzzyOwned` is a `"match"` from `matchAgainstLibrary`,** doc 02 §11.3.3's cascade with its own constants, over a title index of the collection for the exclusion and of the library for the mark, both built by `recommendOwnership`. A `"link"` or a `"flag"` is not ownership: a preprint of a collection member stays, labelled.
> 5. **`contentFilters` runs `identifierFilters`' rules again,** because a fill-in can bring the identifier that shows a work is a member, a date older than the window, or the type that makes it a preprint. A candidate counted once, under the first reason that holds.
> 6. **`maxPerAuthor` counts a row's first and last authors only,** the people a lab is named after. With every author counted, a collision on a middle author such as `Kim J` or `Wang Y` would strip rows that have no lab in common. How often that happens is not measured. A row with no venue or no author is not capped by that rule. The caps are hard, so a narrow pool gives a short list and never a row beyond them.
> 7. **The date window:** older than `window.fromYear` is dropped, a work dated after `window.toYear` stays as in §6.2's note, item 8, and an undated work stays as in `applyClientRecencyFilter`. `publishedDate` only. A partial date's age runs from the earliest day it can name, a date ahead of today reads age 0, and an undated work reads 0 on recency and velocity.
> 8. **A preprint is `isPreprintWork`:** type `preprint`, or type `other` with a preprint server's DOI prefix. `10.1101/` is also Cold Spring Harbor's journals, so a prefix never overrules a source that named a type. "Published version owned" is `relatedVersionIds` against the library's sets, only for a preprint. A published paper whose preprint the user owns stays.
> 9. **Reasons:** §7.6's three phrases first, then the two strongest terms by weight × value. `cites-collection` carries the count of `forward-citations` entries and `author-in-collection` the work's own names in `Family Initials` form. `authorAffinity` is never offered, because the phrase says it and names the people. **`novelty` is offered only when `t` is above its default,** because on the word space it reads about 0.9 on every row and would otherwise be on every line. Above the default it is still on every line of the fixture run (item 15), so the wording `P5-T27` gives it has to carry that. A row with nothing else says `similarity`, so every row has a reason.
> 10. **The row is a composition,** `RecommendationRow { recommendation, inLibrary, dismissed, preprint, checkedByDefault }`, so `recommendation` is exactly what `RecommendationStore.put` takes. `checkedByDefault` is neither in the library nor dismissed.
> 11. **`topicIndex`** is absent at k ≤ 1. With k > 1 a vector sets the nearest centroid, ties to the lowest index, and it overrules the group that asked. With no vector it is the lowest `topicGroup` among the findings, and with no group it is absent, so `P5-T27` needs a group for rows without a topic.
> 12. **MMR reads `cosine` as the run's space returns it:** in [-1, 1] on SPECTER2, as the formula above writes it, and in [0, 1] on the word space. The first pick pays nothing. After it, a row with no vector pays the whole 1, because no vector is no evidence that it differs. A picked row with no vector adds no penalty to the others, and a row with nothing picked to compare against pays 0. The score and the penalty are on different scales between the two spaces, and nothing has measured what that does.
> 13. **Smaller rules.** A score tie goes to the smaller work key, so two runs agree. `discoveredVia` keeps every entry and drops `topicGroup`. An ORCID decides when both sides have one, so `Kim J` and another `Kim J` stay two people, and one found under another spelling still counts. A venue compares by `normalizeTitle` of the container title or its abbreviation, an ISSN without its hyphen and in capitals. A slider outside [0, 1] and a top K that is not a positive integer throw `RangeError`. A store that cannot give the dismissals warns and hides none. `coupling` reads an optional `references` input and is 0 without it.
> 14. **The yield is every 5 000 comparisons (`SCORE_YIELD_EVERY_COMPARISONS`).** A starting value. **Measured 2026-11-05 under Node, not on Zotero's main thread, one run each, in the longest stretch between two yields:** on SPECTER2 at 768 values with four centroids, 5 000 members against 500 candidates took 1 812 ms in all with 500 yields and a longest stretch of 4.9 ms, and `diversify` 13 ms with a longest of 6.3 ms. On the word space, over recorded Europe PMC abstracts repeated to size, 1 000 members against 200 candidates took 897 ms with a longest of 151 ms, and 5 000 against 500 took 9 731 ms with a longest of 496 ms. **That longest stretch is `lexicalSpace`'s corpus build,** 93 ms and 437 ms alone at those sizes, and `src/pipeline/shared/lexical.ts` has no yield inside it. Past it, a word-space read at 5 000 members is about 19 ms. A main-thread stall of that size on a 5 000-paper collection is not measured inside Zotero.
> 15. **What the fixture run holds, on the word space, 2026-11-05.** 240 merged candidates from eleven recorded Europe PMC answers, 15 of them the collection, strategies assigned by the test, no key. `identifierFilters` dropped 15 as members and 75 outside the window, `contentFilters` 38 with no abstract, so 112 were scored and 30 listed, by 30 first authors. Scores ran 0.169 to 0.317, median 0.259, with similarity's median at 0.122 and novelty's at 0.913. Against `t` = 0.25, the listed 30 kept 27 at `t` = 0, 27 at 0.5, 23 at 0.75 and 20 at 1, so with all eight terms in the score no position empties the list. `novelty` was a reason on 30 of 30 at every `t` above the default. Coupling and venue affinity read 0 on every row, author affinity on all but one. A reversed union gave the same 30 in the same order. One run of one collection: it shows the mechanism, and nothing about whether these are good papers.
> 16. **What a keyless run holds on doubled answers, 2026-11-06 (`plan/08` `P5-T28`; one run under Node through the real adapters and the real pipeline, not in Zotero; the answers come from `test/integration/support/noKeyTransport.ts`, so they say nothing about any service).** 30 hand-written saved papers, the default `sources`, a window of 20 years. 20 requests of the budget of 40: one `elink`, two `efetch`, two `esearch`, ten Europe PMC `citations`, one keyword request each to Europe PMC, Crossref and arXiv, one author watch and one Europe PMC DOI lookup. bioRxiv and medRxiv send nothing, and Semantic Scholar is not asked. 30 rows were listed, of which by title 5 came from PubMed's similar list, 7 from Europe PMC's keyword page and 12 from the author watch.
>     - **Generator (c) added no row.** All ten requests were answered from one recorded page of 25 relation rows, and 0 of those 25 hold a DOI or an abstract. A DOI is what the fill-in asks by (`backfillAbstracts` counted 27 works `withoutDoi`), so each such row reaches `contentFilters` with no abstract and is dropped. Without a key, a forward-citation row survives only when another list found the same work with an abstract, and no row did on these answers. Ten of the run's 20 requests went there. This stays as a stated limit: no finishing condition depends on it, and `P5-T30` reads the live figure.
>     - **What the seed limit of `plan/00` §6 item 341(c) costs.** 30 recorded Europe PMC abstracts, the first six with a DOI, a PMID and an abstract from each of five files, gave 15 seeds: 5, 2, 5, 3 and 0 from the five files. Generators (b) and (c) read the first ten: 4, 1, 4, 1 and 0. So one file in five, a fifth of the collection, was never asked from by either. Keyword search and the author watch read no seed, so they do not pay this. One run of one collection.

### 7.5 Pseudocode

```ts
async function recommendFromCollection(
  collectionId: number,
  settings: RecSettings,
): Promise<ScoredCandidate[]> {

  // ---------- 1. PROFILE ----------
  const items    = await Zotero.Collections.get(collectionId).getChildItems();
  const records  = items.map(toCanonicalRecord).filter(r => r.type !== 'other');
  if (records.length < 5) throw new TooFewItemsError(records.length);

  const owned    = await buildLibraryIndex();                    // doc 02 §11.6, whole library
  await ensureEmbeddings(records, settings.embeddingModel);      // cache-first, §9
  const profile  = buildProfile(records, owned, settings);       // §7.2

  // ---------- 2. GENERATE (concurrent across hosts, serial within) ----------
  const budget = new RequestBudget(settings.maxRequests ?? 40);
  const [recs, pmra, fwd, kw, watch] = await Promise.allSettled([
    genS2Recommendations(profile, budget),      // api.semanticscholar.org
    genPubMedRelated(profile, budget),          // eutils.ncbi.nlm.nih.gov
    genForwardCitations(profile, budget),       // api.semanticscholar.org (queued after recs)
    genKeywordSearch(profile, budget),          // ebi.ac.uk + export.arxiv.org
    genAuthorVenueWatch(profile, budget),       // ebi.ac.uk
  ]);

  // A generator that fails must not fail the feature.
  const buckets = [recs, pmra, fwd, kw, watch]
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<Candidate[]>).value);
  if (buckets.length === 0) throw new AllGeneratorsFailedError();

  // ---------- 3. MERGE + FILTER ----------
  let candidates = dedupeAndMerge(buckets.flat());               // doc 02 §11
  candidates = candidates.filter(c => passesHardFilters(c, profile, settings));

  // Hydrate only survivors — never hydrate the raw union.
  await hydrateMetadata(candidates, budget);                     // /paper/batch, 100/call
  await ensureEmbeddings(candidates, settings.embeddingModel);   // batched, cache-first

  // ---------- 4. SCORE ----------
  const t = settings.explorationSlider ?? 0.25;
  const W = { ...BASE_WEIGHTS, sim: 0.40 - 0.40 * t, nov: 0.40 * t };   // §7.4, sum stays 1.00

  const scored = candidates.map(c => {
    // maxCosineToCentroids / maxCosineToCollection both return the [0,1]-rescaled
    // (cosine + 1) / 2, so `sim` and `nov` are on the same scale as every other term.
    const parts = {
      sim:  maxCosineToCentroids(c, profile.centroids),
      rec:  Math.exp(-ageYears(c) / 1.5),
      vel:  Math.min(1, (c.metrics.citationCount ?? 0) / Math.max(0.25, ageYears(c)) / 20),
      nov:  1 - maxCosineToCollection(c, profile),
      auth: Math.min(1, 0.5 * countProfileAuthors(c, profile)),
      ven:  venueAffinity(c, profile),
      gen:  Math.min(1, (c.generators.size - 1) / 3),
      coup: couplingWithCollection(refDois(c), profile.refIndex),       // §2.3
    };
    return { ...c, score: dot(W, parts), parts, reasons: explain(c, parts) };
  });

  // ---------- 5. PRESENT ----------
  return diversify(scored.sort((a, b) => b.score - a.score), {
    maxPerAuthor: 2,          // no single lab dominating the list
    maxPerVenue:  4,
    mmrLambda:    0.75,       // maximal marginal relevance against already-selected
  }).slice(0, settings.topK ?? 30);
}
```

*Corrected 2026-11-02 (`plan/reports/phase5-review.md`; `plan/08` `P5-T24`, `P5-T25`): `passesHardFilters` cannot run whole before `hydrateMetadata`, because a candidate's abstract and tldr are known only after it. The filters split: the identifier-level ones (in the source collection, dismissed, outside the date window, a preprint whose published version is owned) run where the sketch has them, and "no abstract and no tldr" runs after `hydrateMetadata` and `ensureEmbeddings`, before scoring. Without a Semantic Scholar key, neither step sends anything to Semantic Scholar (`plan/00` §6 item 320(a)): metadata comes from Europe PMC and PubMed, and similarity falls back to §5.5.*

**`diversify` is not optional.** Without it, a collection focused on one lab returns ten papers from
that lab, which the user experiences as a broken recommender even when every item scores highly.
Standard MMR:

```
MMR(c) = λ · score(c) − (1 − λ) · max cosine(c, s) for s already selected
```

### 7.6 Presentation

Group by cluster when the profile has more than one centroid, and show a one-line reason per item:

> **Base editing corrects…** · *Nat Biotechnol*, 2026 · 4 citations
> Recommended by Semantic Scholar · cites 3 papers in your collection · **Liu DR** is in your
> collection · similarity 0.79
> `[ Add ]  [ Not interested ]`

"Not interested" writes to the dismissed store and feeds `negativePaperIds` on the next run. Make
that loop visible ("we'll show fewer like this") so the user understands the feature improves.

> **As built 2026-11-05 (`plan/08` `P5-T27`; `reasonRefs` and `groupedRows` in `src/ui/viewModels/recommendViewModel.ts`, the row in `buildRow` in `addon/content/searchDialog.js`).** `08-ui-ux-spec.md` §5.4's section "The results" holds how this reads, and what differs from the sample above: the score is not shown as a number, a row's reason line is its own column, and the import is the window's ticked rows rather than an `[ Add ]` on each. "We'll show fewer like this" is said only when the run had a Semantic Scholar key, because without one nothing reads `negativePaperIds` and the paper only stays out of this collection's list. `novelty` is not put on a row on the word space (§5.4's decision 5).

---

## 8. Evaluation

Recommender quality is unfalsifiable by inspection — everything looks plausible. Build measurement
in from the start.

### 8.1 Held-out precision@k on the user's own collection

**The key insight:** the user's collection *is* a labelled relevance set. Papers in it are known
positives. So hide some and see whether the system finds them.

```
1. Take collection C with |C| = n ≥ 30.
2. Sort C by date added; hold out the most recent 20 % as H. Train profile on C \ H.
   (Time-based split, not random — it simulates the real task: "what should I add next?")
3. Run the pipeline on C \ H, but DISABLE the already-owned filter for members of H.
4. precision@k = |top-k ∩ H| / k
   recall@k    = |top-k ∩ H| / |H|
   MRR         = 1 / rank of the first H member
```

```ts
async function evaluate(collectionId: number, holdoutFrac = 0.2) {
  const all = (await loadRecords(collectionId)).sort((a,b) => a.dateAdded - b.dateAdded);
  const cut = Math.floor(all.length * (1 - holdoutFrac));
  const train = all.slice(0, cut), heldOut = new Set(all.slice(cut).map(r => r.key));

  const ranked = await recommendFromCollection_withProfile(buildProfile(train), {
    suppressOwnedFilterFor: heldOut,
  });

  const hits = (k: number) => ranked.slice(0, k).filter(c => heldOut.has(c.key)).length;
  // findIndex returns -1 when no held-out paper was recovered at all; 1 / (1 + -1) is Infinity,
  // which poisons any averaging across collections. MRR is 0 for a miss, by definition.
  const firstHit = ranked.findIndex(c => heldOut.has(c.key));
  return {
    n: all.length, holdout: heldOut.size,
    'p@5':  hits(5) / 5,   'p@10': hits(10) / 10,  'p@20': hits(20) / 20,
    'r@20': heldOut.size ? hits(20) / heldOut.size : 0,
    mrr:    firstHit < 0 ? 0 : 1 / (1 + firstHit),
  };
}
```

**Interpreting the numbers — calibrate expectations before anyone panics.** The held-out papers are
a handful of specific items out of millions of candidates. **p@10 of 0.10–0.20 is a good result**
here; anything above 0.30 probably indicates leakage (check that the held-out papers aren't reachable
through the owned-filter bypass in a way that also boosted their score).

The measure is most useful **relatively**: it tells you whether a weight change or a new generator
helped, on this user's real data. That is exactly what you need and cannot get any other way without
a backend.

### 8.2 Ablation

Run the same held-out evaluation with each generator disabled in turn. This answers the questions
that determine what to ship:

- Does pmra add anything on top of S2 Recommendations, or is it redundant?
- Is the embedding term worth its request budget?
- Does the author-watch generator carry its weight?

Ship a hidden developer command (`research_helper: run evaluation`) that dumps a CSV. Two hours with
five real collections will teach more than any amount of reasoning about weights.

### 8.3 Sanity checks to run before any human evaluation

Cheap, automatic, and they catch the bugs that actually happen:

| Check | Failure means |
|---|---|
| Seed paper never appears in its own recommendations | self-filter broken |
| ≥ 95 % of results fall inside the date window | filter applied after truncation |
| Zero results already in the library | owned-index broken (very common — check `PMID` field reads) |
| Result set has ≥ 5 distinct first authors | diversify not running |
| Score distribution is not degenerate (all ~equal) | a weight is zero, or a term always returns a constant |
| Two runs on an unchanged collection agree ≥ 90 % | non-determinism from partial API failures |
| Every result has an abstract or tldr | abstract filter bypassed |

*Corrected 2026-11-05 (`plan/08` `P5-T24`; FR-46): for recommendations, "already in the library" in the third row reads "already in the source collection". A library item outside it stays, marked (§7.4's note). As built, every row of this table is a test on a recorded fixture run in `test/unit/pipeline/recommendScore.test.ts`, and that says the filters run: the sixth row's "partial API failures" are not simulated there, and `P5-T30` is the first real run.*

### 8.4 Implicit user feedback

Once shipped, the real signal is behavioural. Log locally, never transmit:

| Event | Interpretation |
|---|---|
| Added to collection | strong positive |
| Clicked through to the paper but did not add | weak positive |
| "Not interested" | strong negative → `negativePaperIds` |
| Ignored entirely | weak negative |

Compute a rolling **add rate** (added / shown). If it drops below ~5 %, the profile has probably
drifted — prompt the user to reselect seeds or split the collection.

### 8.5 What not to do

- **Do not** evaluate by asking an LLM whether recommendations look relevant. It will say yes, and
  its judgement correlates with abstract-word-overlap — the very thing you are trying to improve on.
- **Do not** optimise weights against a single collection; you will overfit one user's field.
- **Do not** ship an A/B framework. There is no backend to collect it, and the sample size is one
  user.

---

## 9. Rate-limit-aware batching and caching

The binding constraint is **Semantic Scholar at 1 request/second with a key**. Everything here
exists to spend those requests well.

### 9.1 Principles

1. **Never loop per paper.** Any `for (paper of papers) await fetch(...)` is a bug. Use
   `/paper/batch` (100–200 IDs), `elink` with multiple `id` params, Europe PMC OR-queries.
2. **Filter before hydrating.** Cheap generators return IDs. Apply owned/date/type filters on IDs
   alone, then fetch metadata for survivors only. A 2000-candidate union typically drops to ~200
   before a single hydration request.
3. **One scheduler per host** (doc 02 §2.4). NCBI, Europe PMC, and S2 budgets are independent —
   run those concurrently.
4. **Every generator is optional.** `Promise.allSettled`, never `Promise.all`. A 429 from Semantic
   Scholar must degrade the result, not fail it.
5. **Cache first, always.** Check the cache before the scheduler, not after.

### 9.2 Cache design

Plugin-owned SQLite, local-only, never synced.

**There is one cache table, and this document does not declare it.**
`07-architecture-and-data-model.md` §8.3 owns it as `cache_entry` in `research-helper.sqlite`, and
doc 07 §9.1 owns key construction (a SHA-256 digest of a canonical ordered string, not a
human-readable key), §9.2 the namespace set and the size caps, §9.3 invalidation and §9.4 eviction.
An earlier draft of this section declared a second table, `rh_cache`, with its own columns and
indexes; a second cache table in the same database is a defect, and it has been removed. Reproduced
below so this document reads on its own; **§8.3 wins on any disagreement, and a new column goes
there first**:

```sql
CREATE TABLE cache_entry (
  namespace    TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT,                  -- inline value, or NULL when blob_path set
  blob_path    TEXT,                  -- relative path for large values
  size_bytes   INTEGER NOT NULL,
  tags         TEXT NOT NULL DEFAULT '',   -- comma-joined
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  last_access  INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX idx_cache_expiry ON cache_entry(expires_at);
CREATE INDEX idx_cache_lru    ON cache_entry(last_access);
```

Everything this section caches — S2 paper records, `elink` neighbours, S2 recommendations, Europe
PMC responses, ID cross-walks — is an upstream API payload and therefore lives in doc 07 §9.2's
`source-response` namespace, whose entries doc 07 already splits by kind (24 h for search results,
30 d for ID lookups and metadata). The one exception is the SPECTER2 row below, which belongs to doc
07 §9.2's separate `embedding` namespace — the vectors themselves live in the `embedding` table of
§5.4, not in `cache_entry`. The table below is this document's finer, per-signal refinement of those
namespaces, and it is what this section owns; the namespace set itself, and every size cap, are
doc 07 §9.2's and are not restated here.

**TTLs, chosen by how fast the underlying data actually changes:**

| Data | TTL | Why |
|---|---|---|
| Paper metadata (title, authors, venue, year, abstract) | **30 days** | Effectively immutable once published |
| SPECTER2 embedding | **permanent** (invalidate on model change) | Deterministic per paper |
| ID cross-walk (PMID↔DOI↔PMCID) | **permanent** | Never changes |
| References of a paper | **90 days** | Fixed at publication |
| Citations of a paper | **7 days** | Grows continuously |
| `citationCount` | **7 days** | Same |
| pmra `elink` neighbours | **14 days** | Recomputed as MEDLINE grows |
| S2 recommendations | **3 days** | `from=recent` pool turns over fast |
| Keyword search results | **1 day** | New papers appear daily |
| Negative cache (404 / unresolvable ID) | **7 days** | Stops re-requesting known-missing papers |

**The negative cache is not an optimisation, it is a correctness feature.** Without it, a
collection containing five book chapters with no S2 record re-requests them on every run, wasting
five seconds and eventually tripping a 429.

### 9.3 Request budgeting

```ts
class RequestBudget {
  constructor(private remaining: number) {}
  tryTake(n = 1): boolean {
    if (this.remaining < n) return false;
    this.remaining -= n; return true;
  }
}
```

Generators check the budget before starting and **degrade rather than truncate mid-flight**: if
only 5 requests remain, `genForwardCitations` should process the top 5 seeds, not start 20 and abort
at 5.

Order generators by **value per request**, so a budget-limited run still returns the best available
result:

| Rank | Generator | Requests | Value |
|---|---|---|---|
| 1 | S2 Recommendations POST | 1 | Very high — 200 candidates, learned ranking |
| 2 | Cached everything | 0 | Free |
| 3 | pmra elink | ≤10 (fast host) | High, biomedical only |
| 4 | Europe PMC author/venue watch | 1 | High, cheap, users love it |
| 5 | Europe PMC keyword search | 2 | Medium |
| 6 | S2 forward citations | ~11 | Medium |
| 7 | arXiv keyword search | 3 (**9 s**) | Medium, domain-dependent |
| 8 | Co-citation | 2 (batched) | Low–medium, needs `citationCount ≥ 20` |

### 9.4 Concurrency shape

```ts
await Promise.allSettled([
  runQueue('api.semanticscholar.org', [recsTask, fwdCiteTask, batchHydrateTask]),  // serial, 1/s
  runQueue('eutils.ncbi.nlm.nih.gov', pmraTasks),                                   // serial, 3–10/s
  runQueue('www.ebi.ac.uk',           [kwTask, watchTask]),                         // serial, 5/s
  runQueue('export.arxiv.org',        arxivTasks),                                  // serial, 1/3s
]);
```

Four hosts in parallel, strictly serial within each. Wall-clock for the *generation* phase is set by
the slowest queue — usually Semantic Scholar (~15 s) or arXiv (9 s for 3 calls), not their sum. The
post-generation hydration and embedding calls are additional, and land on the Semantic Scholar queue
(§7.3).

### 9.5 Backoff and degradation

```ts
async function withRetry<T>(fn: () => Promise<Response>, host: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fn();
    if (res.ok) return res.json();
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('Retry-After'));
      const wait = Number.isFinite(ra) && ra > 0
        ? ra * 1000
        : (2 ** attempt) * 1000 * (0.5 + Math.random());   // full jitter
      scheduler.throttle(host, wait);        // slow the WHOLE host queue, not just this call
      await sleep(wait);
      continue;
    }
    if (res.status === 400 || res.status === 404) throw new PermanentError(res.status);
    throw new TransientError(res.status);
  }
  throw new RateLimitExhausted(host);
}
```

`scheduler.throttle(host, wait)` is the important line: a 429 means *the host* is unhappy, so pause
every queued request for that host, not just the one that failed. Retrying one call while 30 others
keep firing is how a soft throttle becomes an IP block.

> **Authority note.** The sketch above illustrates the host-wide throttle, which is the point of this
> section. The **shipped** backoff shape and attempt cap are owned by
> `07-architecture-and-data-model.md` §7.3 — decorrelated jitter, `sleep = min(cap, random(base,
> prev*3))`, with `limiter.penalize()` parking every waiter on the host — and `Retry-After` always
> wins when present. Do not implement the inline `(2 ** attempt) * 1000 * (0.5 + Math.random())`
> form as a second, differently-shaped backoff.

**Degradation ladder when Semantic Scholar is unavailable:**

```
S2 Recommendations
   ↓ 429/5xx
S2 citations/references                 (same host — likely also failing)
   ↓
Europe PMC citations/references + PubMed pmra
   ↓ (non-biomedical)
Europe PMC / Crossref keyword search on profile terms
   ↓ (no network)
Local TF-IDF similarity over the user's own library    ← always works
```

The last rung matters: a fully offline "find similar papers **already in my library**" is a real,
useful feature that needs no network at all, and it makes the plugin degrade to something useful
rather than to an error dialog.

### 9.6 Prefetch and background refresh

Because a full feature-6 run takes ~25–30 s, warm the cache opportunistically:

- When a user opens a collection, silently fetch SPECTER2 embeddings for any uncached members
  (batched, low priority, cancellable).
- Refresh the embedding cache when items are added, not at recommendation time.

**Constraints:** run only when Zotero is idle, respect a user preference to disable background
network activity entirely (some institutions require this), cancel on collection change, and never
prefetch on a metered connection. **Never** prefetch OpenAlex — it costs the user real money
(doc 02 §9).

---

## Sources

All URLs retrieved and verified 2026-09-08.

**Semantic Scholar**
- [Recommendations API OpenAPI spec (JSON)](https://api.semanticscholar.org/recommendations/v1/swagger.json)
- [Academic Graph OpenAPI spec (JSON)](https://api.semanticscholar.org/graph/v1/swagger.json)
- [Academic Graph API documentation](https://api.semanticscholar.org/api-docs/graph)
- [Semantic Scholar API product page / API key request form](https://www.semanticscholar.org/product/api)
- [SPECTER2: Adapting Scientific Document Embeddings to Multiple Fields and Task Formats (Ai2 blog)](https://medium.com/ai2-blog/specter2-adapting-scientific-document-embeddings-to-multiple-fields-and-task-formats-c95686c06567)
- [SPECTER (allenai/specter)](https://github.com/allenai/specter)

**PubMed / NCBI**
- [Entrez Programming Utilities Help (NBK25501)](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- [The E-utilities In-Depth: Parameters, Syntax and More (NBK25499)](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [E-utilities Usage Guidelines and Requirements (NBK25497)](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [Lin J, Wilbur WJ. *PubMed related articles: a probabilistic topic-based model for content similarity.* BMC Bioinformatics 8:423 (2007)](https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-8-423)
- [Same paper, PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC2212667/)

**Europe PMC**
- [Europe PMC RESTful Web Service](https://europepmc.org/RestfulWebService)

**OpenAlex**
- [OpenAlex API reference](https://help.openalex.org/api-reference/introduction)
- [New Features and Usage-Based Pricing (2026-02-24)](https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/)

**Crossref**
- [Crossref REST API Swagger docs](https://api.crossref.org/swagger-docs)

**Embedding providers**
- [OpenAI: New embedding models and API updates](https://openai.com/index/new-embedding-models-and-api-updates/)
- [Google: Gemini Embedding now generally available in the Gemini API](https://developers.googleblog.com/gemini-embedding-available-gemini-api/)
- [Embedding Models 2026: Dimensions, Price, MTEB Specs](https://pecollective.com/tools/text-embedding-models-compared/)

**Internal**
- [doc 02 — Literature Database APIs](./02-literature-database-apis.md) — base URLs, auth, rate
  limits, canonical schema, deduplication, query translation.

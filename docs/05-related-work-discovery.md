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

---

## 6. Feature 2 — related papers for one seed

The simple case: one selected Zotero item, produce a ranked list, write the accepted ones to a
collection.

### 6.1 Pipeline

```
selected Zotero item
   │
   ├─ resolve IDs (DOI / PMID / arXiv) ─────────── 0–1 requests (doc 02 §3.7)
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

**Total: 5–8 requests, ~6–9 seconds** at S2's keyed 1 req/s. Acceptable for an explicit user action
with a progress indicator. Run generators concurrently across *different hosts* (NCBI and S2 have
independent budgets); serialise within a host.

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

#### Seed selection — the highest-leverage decision in the feature

The Recommendations API takes a bounded number of positives (§3.3), so choosing them matters more
than any weight in the scoring formula.

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

### 7.3 Step 2 — candidate generation

| Generator | Call | Requests | Yields |
|---|---|---|---|
| **a. S2 Recommendations** | `POST /papers/` with 15 positives + 10 negatives, `limit=200` | 1 | 200 |
| **b. pmra** | `elink&cmd=neighbor_score` per PMID seed (≤10 seeds) | ≤10 (fast host) | 500–2000 |
| **c. Forward citations** | `/paper/batch` refs, then `/citations` on the top 10 seeds | ~11 | 300–1000 |
| **d. Keyword search** | Top 5 profile terms → Europe PMC + arXiv, last 3 years | 2–4 | 200 |
| **e. Author/venue watch** | Europe PMC `AUTH:"…" AND FIRST_PDATE:[…]` for top 5 authors | 1 (OR-combined) | 50–200 |

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

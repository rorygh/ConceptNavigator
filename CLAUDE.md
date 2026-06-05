# CLAUDE.md

## Project Overview

ConceptAtlas is an AI-powered learning discovery engine.

Given a topic a user wants to learn (e.g. "robotics", "computer vision", "self-driving cars"), the system retrieves relevant university courses, expands prerequisite relationships, and visualises them as an interactive force-directed graph.

The initial data source is the MIT course catalog (~7,083 courses via the FireRoad API).

---

## Core Goals

1. Allow users to search using natural language.
2. Retrieve semantically relevant courses.
3. Understand prerequisite dependencies.
4. Visualise courses as an interactive graph with similarity-based clustering.
5. Explain why courses were recommended.

---

## Architecture

### Data Layer

Files:

* `data/courses.json` — 7,083 MIT courses with parsed AND/OR prerequisite trees
* `data/chroma/` — ChromaDB vector store (7,083 embeddings, 384-dim, `all-MiniLM-L6-v2`)
* `data/similarity.npy` — precomputed all-pairs cosine similarity matrix (float16, ~100 MB), written by `ingest/embed_courses.py`

Course schema:

```python
Course:
    id: str          # e.g. "6.036"
    title: str
    description: str
    units: int
    level: str       # "U" or "G"
    prerequisites: list | dict  # typed AND/OR tree
    related_subjects: list[str]
    instructors: list[str]
    url: str
```

---

### Retrieval Layer

`retrieval/search.py` exposes three cached loaders:

* `_load()` — SentenceTransformer model + ChromaDB collection + courses dict
* `_load_embeddings()` — full 7083×384 float32 embedding matrix
* `_load_similarity_matrix()` — 7083×7083 float16 cosine similarity matrix, loaded from `data/similarity.npy`

`/api/search` (POST): LLM extracts topics from the query, each topic is embedded and matched against course embeddings. Returns top-20 courses + cosine similarity scores for all 7,083 courses.

`/api/similar/{id}` (GET): O(1) row-slice from the precomputed similarity matrix. Used for SELECTED view clustering in the frontend.

---

### LLM Layer

`llm/` implements structured intent extraction using Claude (`claude-haiku-4-5`).

`extract_intent(query)` → `LearningIntent`:

```python
class LearningIntent:
    action: Literal["search", "filter"]
    topics: list[str]      # academic concepts to embed and search for
    filters: Filters       # hard constraints (level, dept, units, instructors, etc.)
    explanation: str       # one-sentence display summary
```

`action="search"` → multi-topic vector search + filter pass.
`action="filter"` → apply hard constraints to all courses, no semantic search.

The explanation is surfaced in the UI as the hint text after a search.

The LLM is responsible for:
* Parsing free-text learning goals into structured search intent
* Extracting topics for semantic search
* Deriving hard filters (level, department, units, instructors, ratings)
* Generating a one-sentence explanation for display

The LLM is not responsible for storing knowledge or retrieving courses directly. Retrieval happens through embeddings and graph traversal.

---

### Graph Layer

`/api/graph` returns all prerequisite edges. The frontend does BFS (`buildPrereqDepths`) to expand the full transitive dependency chain for any selected course.

The graph supports:

* prerequisite depth expansion (unlimited transitive depth)
* successor traversal (one hop)
* visual learning path display

---

### Frontend

Single-page app (`api/static/index.html`) — D3 v7 force simulation on HTML5 Canvas.

Three view modes:

* **GALAXY** — all 7,083 courses clustered by MIT department
* **SEARCH** — top-20 results ring around a virtual query node; background courses at outer ring
* **SELECTED** — selected course at centre; prereqs to the left; successors to the right; background courses in similarity rings (top 30% of cosine similarity pulled into inner rings, bottom 70% at outer ring)

Key behaviours:

* Hover-prefetch: `prefetchSimilarity(id)` fires on first mouse-over, caching similarity scores before click. When scores are cached, SELECTED view scatters background nodes directly to ring positions with no two-stage effect.
* `simCache` dict stores resolved similarity responses by course ID.
* D3 forces use percentile-based radial placement with DJB2 hash jitter to break ring discreteness.

---

## Development Principles

* Prefer simple solutions over complex ones.
* Keep components loosely coupled.
* Make retrieval deterministic when possible.
* Avoid hardcoded topic taxonomies.
* Build for future support of multiple universities.

---

## Running Locally

```bash
pip install -r requirements.txt
# Set ANTHROPIC_API_KEY in environment
python -m ingest.embed_courses   # only needed once (or after data changes)
uvicorn api.main:app --reload
```

`embed_courses.py` writes both `data/chroma/` and `data/similarity.npy`. The server loads the similarity matrix at startup and warms the `lru_cache` so the first `/api/similar` request is instant.

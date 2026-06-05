import json
import numpy as np
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

STATIC      = Path(__file__).parent / "static"
COURSES_PATH = Path(__file__).parent.parent / "data" / "courses.json"

_courses_cache = None


def _all_courses():
    global _courses_cache
    if _courses_cache is None:
        _courses_cache = json.loads(COURSES_PATH.read_text())
    return _courses_cache


def _flatten_prereqs(node) -> list:
    if node is None:
        return []
    if isinstance(node, str):
        if not node or node.startswith("''") or node.upper().startswith("GIR:"):
            return []
        return [node]
    return [id_ for item in node.get("items", []) for id_ in _flatten_prereqs(item)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    from retrieval.search import _load, _load_embeddings, _load_similarity_matrix
    _load()
    _load_embeddings()
    _load_similarity_matrix()   # precompute all-pairs cosine matrix (~100 MB) at startup
    yield


app = FastAPI(lifespan=lifespan)


class SearchRequest(BaseModel):
    query: str
    n: int = 20


class FilterRequest(BaseModel):
    filters: dict


class RefilterRequest(BaseModel):
    topics: list[str]
    filters: dict
    n: int = 20


@app.post("/api/refilter")
def refilter(req: RefilterRequest):
    """Re-run semantic search with updated filters, bypassing the LLM.

    Used when the user modifies filter chips on a search result — re-embeds
    the stored topics and applies the new filter set without another LLM call.
    """
    from retrieval.search import _load, _load_embeddings
    from llm.schema import Filters
    from llm.filters import apply_filters

    model, _, courses_by_id = _load()
    all_ids, E, _ = _load_embeddings()

    try:
        filters = Filters(**req.filters)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid filter object")

    if req.topics:
        topic_vecs = model.encode(req.topics, normalize_embeddings=True).astype(np.float32)
        raw_scores = (E @ topic_vecs.T).max(axis=1).tolist()
    else:
        raw_scores = [0.0] * len(all_ids)

    filtered_ids = {c["id"] for c in apply_filters(_all_courses(), filters)}
    scored = [(rid, s) for rid, s in zip(all_ids, raw_scores) if rid in filtered_ids]
    scored.sort(key=lambda x: -x[1])
    top_n = scored[:req.n]

    return {
        "courses": [
            {
                "id":          cid,
                "title":       courses_by_id[cid]["title"],
                "description": courses_by_id[cid].get("description"),
                "units":       courses_by_id[cid].get("units"),
                "level":       courses_by_id[cid].get("level"),
                "score":       round(float(s), 4),
            }
            for cid, s in top_n
            if cid in courses_by_id
        ],
        "scores":     {rid: round(float(s), 4) for rid, s in zip(all_ids, raw_scores)},
        "filter_ids": list(filtered_ids),
    }


@app.post("/api/filter")
def filter_direct(req: FilterRequest):
    """Apply explicit filter constraints without calling the LLM.

    Used by the frontend when removing a filter chip — avoids a re-LLM round-trip.
    Returns all matching course IDs (no pagination) plus a short explanation.
    """
    from llm.schema import Filters
    from llm.filters import apply_filters

    try:
        filters = Filters(**req.filters)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid filter object")

    results = apply_filters(_all_courses(), filters)
    return {
        "course_ids":  [c["id"] for c in results],
        "count":       len(results),
        "filters":     req.filters,
    }


@app.post("/api/search")
def search(req: SearchRequest):
    from llm.pipeline import search_with_intent
    from retrieval.search import _load, _load_embeddings
    from llm.filters import apply_filters

    model, _, courses_by_id = _load()
    all_ids, E, _ = _load_embeddings()

    result = search_with_intent(req.query, n=req.n)
    intent = result["intent"]
    top_courses = result["courses"]

    # Score every course: embed each extracted topic, take the max cosine similarity.
    # Falls back to embedding the raw query when no topics were extracted (filter-only queries).
    terms = intent.topics if intent.topics else [req.query]
    topic_vecs = model.encode(terms, normalize_embeddings=True).astype(np.float32)
    # shape: (num_courses,) — best match across all topics
    raw_scores = (E @ topic_vecs.T).max(axis=1).tolist()

    # For filter action: return ALL matching IDs so the frontend can highlight every match,
    # not just the top-n truncation.
    filter_ids: list[str] = []
    if intent.action == "filter":
        filter_ids = [c["id"] for c in apply_filters(_all_courses(), intent.filters)]

    score_by_id = dict(zip(all_ids, raw_scores))
    return {
        "courses": [
            {
                "id":          c["id"],
                "title":       c["title"],
                "description": c.get("description"),
                "units":       c.get("units"),
                "level":       c.get("level"),
                "score":       round(float(score_by_id.get(c["id"], 0)), 4),
            }
            for c in top_courses
        ],
        "scores":      {rid: round(float(s), 4) for rid, s in zip(all_ids, raw_scores)},
        "filter_ids":  filter_ids,
        "intent":      {
            "action":      intent.action,
            "topics":      intent.topics,
            "filters":     intent.filters.model_dump(),
            "explanation": intent.explanation,
        },
    }


@app.get("/api/courses")
def courses():
    return [
        {
            "id":    c["id"],
            "title": c["title"],
            "units": c["units"],
            "level": c.get("level"),
            "dept":  c.get("dept") or c["id"].split(".")[0],
        }
        for c in _all_courses()
    ]


@app.get("/api/graph")
def graph():
    all_ids = {c["id"] for c in _all_courses()}
    edges = []
    for c in _all_courses():
        for prereq in _flatten_prereqs(c.get("prerequisites")):
            if prereq in all_ids:
                edges.append({"source": prereq, "target": c["id"]})
    return {"edges": edges}


@app.get("/api/course/{course_id:path}")
def course(course_id: str):
    for c in _all_courses():
        if c["id"] == course_id:
            return {
                "id":               c["id"],
                "title":            c["title"],
                "description":      c["description"],
                "units":            c["units"],
                "level":            c.get("level"),
                "prereqs_flat":     _flatten_prereqs(c.get("prerequisites")),
                "related_subjects": c.get("related_subjects", []),
                "instructors":      c.get("instructors", []),
                "url":              c.get("url"),
            }
    raise HTTPException(status_code=404, detail="Course not found")


@app.get("/api/similar/{course_id:path}")
def similar_courses(course_id: str):
    from retrieval.search import _load, _load_embeddings, _load_similarity_matrix
    _, _, courses_by_id = _load()
    if course_id not in courses_by_id:
        raise HTTPException(status_code=404, detail="Not found")

    all_ids, _, id_to_idx = _load_embeddings()
    idx = id_to_idx.get(course_id)
    if idx is None:
        raise HTTPException(status_code=404, detail="No embedding found")

    # O(1) row lookup into precomputed all-pairs matrix
    S = _load_similarity_matrix()
    scores = S[idx].astype(np.float32).tolist()

    return {
        "similar": {
            rid: round(float(s), 2)
            for rid, s in zip(all_ids, scores)
            if rid != course_id
        }
    }


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")

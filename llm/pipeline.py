"""End-to-end pipeline: free-text query → filtered ranked courses."""
from .extract_intent import extract_intent
from .filters import apply_filters
from .schema import LearningIntent


def search_with_intent(query: str, n: int = 10) -> dict:
    """Parse the query, search semantically on extracted topics, apply hard filters.

    Returns:
        {
          "intent":   LearningIntent,   # what the LLM understood
          "courses":  list[dict],        # filtered, ranked results
          "raw_hits": int,               # how many vector hits before filtering
        }
    """
    from retrieval.search import search as _vector_search

    intent = extract_intent(query)

    # Search using each extracted topic and merge by score (higher rank = earlier appearance)
    seen: dict[str, int] = {}   # course_id → best rank
    for topic in intent.topics:
        for rank, course in enumerate(_vector_search(topic, n=n * 2)):
            cid = course["id"]
            if cid not in seen or rank < seen[cid]:
                seen[cid] = rank

    # Rebuild ordered list, fetch full course data for filtering
    from retrieval.search import _load
    _, _, courses_by_id = _load()

    ordered = sorted(seen.items(), key=lambda x: x[1])
    candidates = [courses_by_id[cid] for cid, _ in ordered if cid in courses_by_id]
    raw_hits   = len(candidates)

    filtered = apply_filters(candidates, intent.filters)[:n]

    return {
        "intent":   intent,
        "courses":  filtered,
        "raw_hits": raw_hits,
    }

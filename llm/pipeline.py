"""End-to-end pipeline: free-text query → filtered ranked courses."""
from .extract_intent import extract_intent
from .filters import apply_filters
from .schema import LearningIntent


def search_with_intent(query: str, n: int = 10) -> dict:
    """Parse the query, then either search semantically or filter all courses.

    Returns:
        {
          "intent":   LearningIntent,   # what the LLM understood
          "courses":  list[dict],        # filtered, ranked results
          "raw_hits": int,               # candidates before final truncation
        }
    """
    from retrieval.search import _load

    intent = extract_intent(query)

    if intent.action == "filter":
        _, _, courses_by_id = _load()
        candidates = list(courses_by_id.values())
        raw_hits = len(candidates)
        filtered = apply_filters(candidates, intent.filters)[:n]
    else:
        from retrieval.search import search_multi

        # Embed all topics in a single batch call, then merge by rank.
        candidates = search_multi(intent.topics, n=n * 2)
        raw_hits = len(candidates)
        filtered = apply_filters(candidates, intent.filters)[:n]

    return {
        "intent":   intent,
        "courses":  filtered,
        "raw_hits": raw_hits,
    }

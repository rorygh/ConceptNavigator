"""Apply hard filters from a LearningIntent to a list of course dicts."""
from .schema import Filters


def apply_filters(courses: list[dict], filters: Filters) -> list[dict]:
    """Return only courses that satisfy all hard constraints in `filters`."""
    result = courses

    if filters.level:
        result = [c for c in result if c.get("level") == filters.level]

    if filters.depts:
        dept_set = set(filters.depts)
        result = [c for c in result if c["id"].split(".")[0] in dept_set]

    if filters.max_units is not None:
        result = [c for c in result if (c.get("units") or 0) <= filters.max_units]

    if filters.exclude_keywords:
        lower_kws = [kw.lower() for kw in filters.exclude_keywords]

        def _no_excluded(c: dict) -> bool:
            text = (c.get("title", "") + " " + c.get("description", "")).lower()
            return not any(kw in text for kw in lower_kws)

        result = [c for c in result if _no_excluded(c)]

    return result

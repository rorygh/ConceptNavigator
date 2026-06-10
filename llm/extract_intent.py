"""Parse a free-text learning query into structured LearningIntent using Claude."""
import os
import anthropic
from .schema import Filters, LearningIntent

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        key = os.environ.get("ANTHROPIC_API_KEY") or os.environ["RUNPOD_ANTHROPIC_API_KEY"]
        _client = anthropic.Anthropic(api_key=key)
    return _client


_SYSTEM = """\
You are a learning assistant for MIT OpenCourseWare. Parse the user's query into structured \
search intent.

MIT department numbers for reference:
1=Civil Eng  2=Mech Eng  3=Materials  4=Architecture  5=Chemistry  6=EECS  7=Biology
8=Physics  9=Brain & Cog Sci  10=Chem Eng  11=Urban Studies  12=Earth & Planetary Sci
14=Economics  15=Sloan (Management)  16=AeroAstro  17=Political Sci  18=Mathematics
20=Biological Eng  22=Nuclear Sci  24=Philosophy  HST=Health Sci & Tech

Course ratings are on a 0–7 scale.
Instructor names in the data are abbreviated (e.g. "J. Williams") — match by last name only.

Decide between two actions:
- "search": user wants to discover courses by topic/subject — use this whenever the query names \
any academic subject, field, or concept, even if it also includes constraints like level or prereqs \
(e.g. "undergrad ML with no prereqs", "physics of stars", "grad robotics under 9 units")
- "filter": user specifies ONLY hard constraints with no topic to discover \
(e.g. "show courses by Williams", "list all no-prereq EECS courses", "grad math under 9 units")

Extract topics (for search), hard constraints (level, dept, units, instructor, rating, \
prereqs, excluded keywords), and which action to take.

For the `level` filter: only set it when the user explicitly says "undergraduate", "undergrad", \
"grad", "graduate", "master's", "PhD", or similar explicit level words. \
Do NOT infer level from words like "beginner", "introductory", "from scratch", "basic", or "advanced" \
— those describe difficulty, not academic level."""

# Tool schema for structured extraction — forces Claude to return validated JSON
_EXTRACT_TOOL = {
    "name": "extract_intent",
    "description": "Return structured learning intent extracted from the user query.",
    "input_schema": {
        "type": "object",
        "required": ["action", "topics", "filters", "explanation"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["search", "filter"],
                "description": "'search' for topic-driven discovery, 'filter' for constraint-only queries",
            },
            "topics": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 6,
                "description": "Academic concepts to embed and search for. Empty array when action='filter'.",
            },
            "filters": {
                "type": "object",
                "properties": {
                    "level": {
                        "type": ["string", "null"],
                        "enum": ["U", "G", None],
                        "description": "Course level restriction",
                    },
                    "depts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "MIT dept numbers, e.g. ['6', '18']",
                    },
                    "max_units": {
                        "type": ["integer", "null"],
                        "description": "Max units per course",
                    },
                    "exclude_keywords": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Words that must not appear in course text",
                    },
                    "instructors": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Instructor last names to match, e.g. ['Williams']",
                    },
                    "min_rating": {
                        "type": ["number", "null"],
                        "description": "Minimum rating on 0-7 scale",
                    },
                    "has_prereqs": {
                        "type": ["boolean", "null"],
                        "description": "true=must have prereqs, false=must have none, null=no restriction",
                    },
                    "requires_courses": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Course IDs that must be in the course's prerequisites, e.g. ['18.06']",
                    },
                },
            },
            "explanation": {
                "type": "string",
                "description": "One sentence summarising what was understood",
            },
        },
    },
}


def extract_intent(query: str) -> LearningIntent:
    """Parse a natural language learning goal into structured LearningIntent.

    Uses tool_choice={"type":"tool"} to guarantee a structured response.
    """
    client = _get_client()
    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=512,
        system=[{"type": "text", "text": _SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": query}],
        tools=[{**_EXTRACT_TOOL, "cache_control": {"type": "ephemeral"}}],
        tool_choice={"type": "tool", "name": "extract_intent"},
    )

    tool_use = next(b for b in response.content if b.type == "tool_use")
    data = tool_use.input

    raw_filters = data.get("filters", {})
    filters = Filters(
        level=raw_filters.get("level"),
        depts=raw_filters.get("depts", []),
        max_units=raw_filters.get("max_units"),
        exclude_keywords=raw_filters.get("exclude_keywords", []),
        instructors=raw_filters.get("instructors", []),
        min_rating=raw_filters.get("min_rating"),
        has_prereqs=raw_filters.get("has_prereqs"),
        requires_courses=raw_filters.get("requires_courses", []),
    )

    return LearningIntent(
        action=data.get("action", "search"),
        topics=data.get("topics", []),
        filters=filters,
        explanation=data.get("explanation", ""),
    )

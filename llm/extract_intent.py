"""Parse a free-text learning query into structured LearningIntent using Claude."""
import anthropic
from .schema import Filters, LearningIntent

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


_SYSTEM = """\
You are a learning assistant for MIT OpenCourseWare. Parse the user's learning goal into \
structured search intent.

MIT department numbers for reference:
1=Civil Eng  2=Mech Eng  3=Materials  4=Architecture  5=Chemistry  6=EECS  7=Biology
8=Physics  9=Brain & Cog Sci  10=Chem Eng  11=Urban Studies  12=Earth & Planetary Sci
14=Economics  15=Sloan (Management)  16=AeroAstro  17=Political Sci  18=Mathematics
20=Biological Eng  22=Nuclear Sci  24=Philosophy  HST=Health Sci & Tech

Extract what the user wants to learn (topics) and any hard constraints they mention \
(level, department, unit limits, topics to avoid)."""

# Tool schema for structured extraction — forces Claude to return validated JSON
_EXTRACT_TOOL = {
    "name": "extract_intent",
    "description": "Return structured learning intent extracted from the user query.",
    "input_schema": {
        "type": "object",
        "required": ["topics", "filters", "explanation"],
        "properties": {
            "topics": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 6,
                "description": "Academic concepts to embed and search for, e.g. 'machine learning', 'linear algebra'",
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
        model="claude-opus-4-8",
        max_tokens=512,
        system=_SYSTEM,
        messages=[{"role": "user", "content": query}],
        tools=[_EXTRACT_TOOL],
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
    )

    return LearningIntent(
        topics=data["topics"],
        filters=filters,
        explanation=data.get("explanation", ""),
    )

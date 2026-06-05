from pydantic import BaseModel, Field


class Filters(BaseModel):
    level: str | None = Field(
        None,
        description="'U' for undergraduate only, 'G' for graduate only, null for no restriction",
    )
    depts: list[str] = Field(
        default_factory=list,
        description="MIT dept numbers to restrict to, e.g. ['6', '18']. Empty = any dept.",
    )
    max_units: int | None = Field(
        None,
        description="Hard upper limit on course units. null = no limit.",
    )
    exclude_keywords: list[str] = Field(
        default_factory=list,
        description="Words/phrases that must NOT appear in the course title or description.",
    )


class LearningIntent(BaseModel):
    topics: list[str] = Field(
        description="2-5 specific academic concepts to search for semantically.",
    )
    filters: Filters = Field(
        default_factory=Filters,
        description="Hard constraints extracted from the query.",
    )
    explanation: str = Field(
        description="One sentence describing what the user wants, for display.",
    )

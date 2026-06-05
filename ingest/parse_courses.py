import json
from pathlib import Path
from typing import Union, Literal
from pydantic import BaseModel

DEPT_PATH = Path(__file__).parent / "departments.json"
_DEPT_DATA = json.loads(DEPT_PATH.read_text())
DEPARTMENTS: dict[str, dict] = _DEPT_DATA["departments"]


def _dept_from_id(course_id: str) -> str:
    return course_id.split(".")[0]


# --- Prerequisite tree ---

PrereqNode = Union[str, "AndNode", "OrNode"]


class AndNode(BaseModel):
    op: Literal["and"] = "and"
    items: list[PrereqNode]


class OrNode(BaseModel):
    op: Literal["or"] = "or"
    items: list[PrereqNode]


AndNode.model_rebuild()
OrNode.model_rebuild()


# --- Course model ---

class Course(BaseModel):
    id: str
    title: str
    description: str
    units: int
    level: str | None = None
    dept: str = ""
    prerequisites: PrereqNode | None = None
    related_subjects: list[str] = []
    rating: float | None = None
    url: str | None = None
    instructors: list[str] = []
    schedule: str | None = None


# --- Prerequisite parser ---
# Grammar:
#   expr   = term ('/' term)*      slash = OR
#   term   = factor (',' factor)*  comma = AND
#   factor = '(' expr ')' | atom

def _tokenize(s: str) -> list[str]:
    tokens, i = [], 0
    while i < len(s):
        if s[i] in "(),/":
            tokens.append(s[i])
            i += 1
        elif s[i:i+2] == "''":
            end = s.find("''", i + 2)
            if end == -1:
                tokens.append(s[i:])
                break
            tokens.append(s[i:end + 2])
            i = end + 2
        elif s[i].isspace():
            i += 1
        else:
            j = i
            while j < len(s) and s[j] not in "(),/ \t\n":
                j += 1
            tokens.append(s[i:j])
            i = j
    return [t for t in tokens if t]


def _parse_expr(tokens: list[str], pos: int) -> tuple[PrereqNode, int]:
    node, pos = _parse_term(tokens, pos)
    items = [node]
    while pos < len(tokens) and tokens[pos] == "/":
        pos += 1
        node, pos = _parse_term(tokens, pos)
        items.append(node)
    return (OrNode(items=items) if len(items) > 1 else items[0]), pos


def _parse_term(tokens: list[str], pos: int) -> tuple[PrereqNode, int]:
    node, pos = _parse_factor(tokens, pos)
    items = [node]
    while pos < len(tokens) and tokens[pos] == ",":
        pos += 1
        node, pos = _parse_factor(tokens, pos)
        items.append(node)
    return (AndNode(items=items) if len(items) > 1 else items[0]), pos


def _parse_factor(tokens: list[str], pos: int) -> tuple[PrereqNode, int]:
    if pos < len(tokens) and tokens[pos] == "(":
        node, pos = _parse_expr(tokens, pos + 1)
        if pos < len(tokens) and tokens[pos] == ")":
            pos += 1
        return node, pos
    if pos < len(tokens):
        return tokens[pos], pos + 1
    return "", pos


def parse_prereqs(s: str) -> PrereqNode | None:
    tokens = _tokenize(s.strip())
    if not tokens:
        return None
    node, _ = _parse_expr(tokens, 0)
    return node or None


# --- Main ---

RAW_PATH = Path(__file__).parent.parent / "data" / "courses_raw.json"
OUT_PATH = Path(__file__).parent.parent / "data" / "courses.json"


def parse():
    raw = json.loads(RAW_PATH.read_text())
    courses, errors = [], 0
    for r in raw:
        try:
            subject_id = r["subject_id"]
            course = Course(
                id=subject_id,
                title=r["title"],
                description=r["description"],
                units=r["total_units"],
                level=r.get("level"),
                dept=_dept_from_id(subject_id),
                prerequisites=parse_prereqs(r.get("prerequisites", "")),
                related_subjects=r.get("related_subjects", []),
                rating=r.get("rating"),
                url=r.get("url"),
                instructors=r.get("instructors", []),
                schedule=r.get("schedule"),
            )
            courses.append(course.model_dump())
        except Exception as e:
            print(f"Skipping {r.get('subject_id')}: {e}")
            errors += 1

    OUT_PATH.write_text(json.dumps(courses, indent=2))
    print(f"Parsed {len(courses)} courses ({errors} skipped) → {OUT_PATH}")


if __name__ == "__main__":
    parse()

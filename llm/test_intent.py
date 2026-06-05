"""Quick manual test: python -m llm.test_intent"""
from llm.extract_intent import extract_intent

QUERIES = [
    "I want to learn machine learning, undergrad level only",
    "robotics and computer vision, nothing more than 12 units",
    "quantum computing in the physics or EECS department",
    "economics but not micro, graduate level",
]

for q in QUERIES:
    print(f"\nQuery: {q!r}")
    intent = extract_intent(q)
    print(f"  Topics:      {intent.topics}")
    print(f"  Level:       {intent.filters.level}")
    print(f"  Depts:       {intent.filters.depts}")
    print(f"  Max units:   {intent.filters.max_units}")
    print(f"  Exclude:     {intent.filters.exclude_keywords}")
    print(f"  Explanation: {intent.explanation}")

"""Interactive search REPL. Run with: python -m retrieval.repl"""
import textwrap
from retrieval.search import search


def _fmt(course: dict) -> str:
    prereqs = course.get("prerequisites")
    prereq_str = str(prereqs) if prereqs else "none"
    desc = textwrap.fill(course["description"], width=72, initial_indent="  ", subsequent_indent="  ")
    return (
        f"\n  [{course['id']}] {course['title']}  ({course['units']} units)\n"
        f"{desc}\n"
        f"  Prerequisites: {prereq_str}"
    )


def main():
    print("ConceptAtlas search — type a learning goal, or 'q' to quit.\n")
    print("Loading model (first run may take a few seconds)...")

    # Warm up the model before the loop so the first query is fast.
    search("warmup", n=1)
    print("Ready.\n")

    while True:
        try:
            query = input("Search > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not query or query.lower() == "q":
            break

        results = search(query, n=5)
        if not results:
            print("No results.\n")
            continue

        print(f"\nTop {len(results)} courses for: \"{query}\"")
        print("─" * 60)
        for i, course in enumerate(results, 1):
            print(f"{i}.{_fmt(course)}")
        print()


if __name__ == "__main__":
    main()

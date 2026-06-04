import json
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

COURSES_PATH = Path(__file__).parent.parent / "data" / "courses.json"
CHROMA_PATH = Path(__file__).parent.parent / "data" / "chroma"


def embed():
    courses = json.loads(COURSES_PATH.read_text())
    print(f"Loaded {len(courses)} courses")

    print("Loading embedding model...")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    # Build the strings we want to embed — title + description gives the model
    # enough context to understand what each course is actually about.
    texts = [f"{c['title']}. {c['description']}" for c in courses]
    ids = [c["id"] for c in courses]
    metadatas = [{"title": c["title"], "units": c["units"]} for c in courses]

    print("Embedding courses (this takes ~60s on CPU)...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=64)

    print("Storing in ChromaDB...")
    client = chromadb.PersistentClient(path=str(CHROMA_PATH))

    # Delete and recreate so re-running this script stays idempotent.
    try:
        client.delete_collection("courses")
    except Exception:
        pass
    collection = client.create_collection("courses")

    # ChromaDB has a max batch size (~5461), so we add in chunks.
    emb_list = embeddings.tolist()
    chunk = 5000
    for i in range(0, len(ids), chunk):
        collection.add(
            ids=ids[i:i+chunk],
            embeddings=emb_list[i:i+chunk],
            documents=texts[i:i+chunk],
            metadatas=metadatas[i:i+chunk],
        )

    print(f"Done. {collection.count()} courses indexed → {CHROMA_PATH}")


if __name__ == "__main__":
    embed()

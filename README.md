# ConceptNavigator

AI-powered learning discovery engine. Given a topic you want to learn, it retrieves relevant university courses, expands prerequisite relationships, and generates a personalized learning roadmap.

Initial data source: MIT OpenCourseWare.

## How it works

1. **Input** — free-form learning goal ("I want to learn robotics")
2. **Topic extraction** — LLM extracts relevant concepts from the query
3. **Semantic search** — query is embedded and matched against course embeddings
4. **Prerequisite expansion** — a directed graph walks dependencies for each matched course
5. **Roadmap generation** — LLM constructs an ordered learning path with explanations

## Example

```
Input:  I want to learn about self-driving cars.

Recommended Courses
  1. Introduction to Robotics
  2. Computer Vision
  3. Feedback Control Systems

Suggested Learning Path
  Linear Algebra
  → Programming Fundamentals
  → Control Systems
  → Computer Vision
  → Robotics
  → Advanced Autonomy
```

## Stack

| Layer      | Tool                                  |
|------------|---------------------------------------|
| Embeddings | `sentence-transformers`               |
| Vector DB  | ChromaDB                              |
| Graph      | NetworkX                              |
| LLM        | Claude (Anthropic)                    |
| API        | FastAPI                               |
| Data       | MIT OpenCourseWare                    |

## Project structure

```
ConceptNavigator/
├── ingest/          # Scrape + parse MIT catalog, generate embeddings
├── retrieval/       # Vector search + graph traversal
├── llm/             # Topic extraction, path generation, explanations
├── api/             # FastAPI app
└── data/            # Persisted course data and vector store
```

## RunPod Deployment

The Dockerfile contains all Python dependencies. Code is cloned and data is bootstrapped on first pod start via `setup.sh`.

### Build and push

```bash
docker build --platform linux/amd64 -t rorygh/conceptnavigator:v1.0 .
docker push rorygh/conceptnavigator:v1.0
```

### Pod config

- **Container image**: `rorygh/conceptnavigator:v1.0`
- **Environment variables**:
  - `RUNPOD_GITHUB_TOKEN` — GitHub PAT (repo read scope)
  - `ANTHROPIC_API_KEY` — Anthropic API key

### First-time setup

```bash
/setup.sh
cd /workspace/ConceptNavigator
```

## Local development

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in API keys
python -m ingest.scrape_mit
uvicorn api.main:app --reload
```

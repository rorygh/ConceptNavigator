# ConceptNavigator

AI-powered learning discovery engine. Given a topic you want to learn, it retrieves relevant university courses, expands prerequisite relationships, and generates a personalized learning roadmap.

Initial data source: MIT course catalog via the [FireRoad API](https://fireroad.mit.edu/reference/catalog).

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
| Data       | MIT via FireRoad API                  |

## Project structure

```
ConceptNavigator/
├── ingest/
│   ├── fetch_mit.py       # Pulls all courses from FireRoad API → data/courses_raw.json
│   ├── parse_courses.py   # Validates schema, parses prereq trees → data/courses.json
│   └── embed_courses.py   # Embeds title+description → data/chroma/ (ChromaDB)
├── retrieval/             # Vector search + graph traversal (next)
├── llm/                   # Topic extraction, path generation, explanations
├── api/                   # FastAPI app
└── data/
    ├── courses_raw.json   # Raw API response (7,083 courses; 65 dropped for missing description)
    ├── courses.json       # Validated courses with parsed AND/OR prerequisite trees
    └── chroma/            # ChromaDB vector store (7,083 embeddings, 384-dim)
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

## Data pipeline

The ingest pipeline runs in three steps:

```bash
python -m ingest.fetch_mit      # fetch raw catalog from FireRoad API
python -m ingest.parse_courses  # validate schema + parse prerequisite trees
python -m ingest.embed_courses  # embed title+description → ChromaDB
```

**`fetch_mit.py`** hits `GET /courses/all?full=true` on the FireRoad API and writes a flat JSON array. It filters out courses with no description (65 of 7,148). Fields retained: `subject_id`, `title`, `description`, `prerequisites`, `total_units`, `level`, `related_subjects`, `rating`, `url`, `instructors`, `schedule`.

**`parse_courses.py`** validates each record against a Pydantic `Course` model and parses the prerequisite string into a typed AND/OR tree. The prereq grammar is: commas = AND, slashes = OR, parentheses = grouping. For example:

```
"GIR:CAL1, ((6.100A, 6.100B)/(6.100L, 16.C20))"

→ AND[
    "GIR:CAL1",
    OR[
      AND["6.100A", "6.100B"],
      AND["6.100L", "16.C20"]
    ]
  ]
```

Special tokens (`GIR:XXX`, `''permission of instructor''`) are preserved as leaf strings in the tree.

**`embed_courses.py`** embeds each course's `title + description` using `sentence-transformers` (`all-MiniLM-L6-v2`, runs locally) and stores the vectors in a persistent ChromaDB collection at `data/chroma/`. Embedding 7,083 courses takes ~4 seconds on CPU.

Example semantic search results (no keyword matching — pure vector similarity):

```
Query: "I want to learn about robotics and self-driving cars"
  [16.405] Robotics: Science and Systems — Presents concepts, principles, and algorithmic foundations for robots and autonomous vehicles...
  [2.12]   Introduction to Robotics — Unified introduction to kinematics, dynamics, control, and motion planning...
  [16.412] Cognitive Robotics — Principles of knowledge representation, inference, and learning applied to robotics...

Query: "how do computers learn from data"
  [6.7900] Machine Learning — Principles, techniques, and algorithms in machine learning from the point of view of statistical inference...
  [6.3800] Introduction to Inference — Introduces probabilistic modeling for problems of inference and machine learning from data...
  [9.54]   Computational Aspects of Biological Learning — Takes a computational approach to learning in the brain by neurons and synapses...

Query: "understanding the human brain and neuroscience"
  [9.11]    The Human Brain — Surveys the core perceptual and cognitive abilities of the human mind...
  [9.13]    The Human Brain — Cross-listed version covering how these abilities are implemented in the brain...
  [HST.130] Neuroscience — Comprehensive study from molecules and cells to systems and behavior...
```

Note: MIT cross-lists many courses across departments (same content, different IDs). Deduplication is handled at the retrieval layer.

| Step | Input | Output | Courses |
|------|-------|--------|---------|
| fetch | FireRoad API | `courses_raw.json` | 7,083 |
| parse | `courses_raw.json` | `courses.json` | 7,083 (0 errors) |
| embed | `courses.json` | `data/chroma/` | 7,083 vectors |

## Local development

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in API keys
python -m ingest.fetch_mit
python -m ingest.parse_courses
uvicorn api.main:app --reload
```

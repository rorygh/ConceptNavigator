# CLAUDE.md

## Project Overview

KnowledgeAtlas is an AI-powered learning discovery engine.

Given a topic a user wants to learn (e.g. "robotics", "computer vision", "self-driving cars"), the system retrieves relevant university courses, expands prerequisite relationships, and generates personalized learning paths.

The initial data source is the MIT course catalog.

---

## Core Goals

1. Allow users to search using natural language.
2. Retrieve semantically relevant courses.
3. Understand prerequisite dependencies.
4. Generate ordered learning roadmaps.
5. Explain why courses were recommended.

---

## Architecture

### Data Layer

Store:

* Courses
* Prerequisite relationships
* Generated topics
* Embeddings

Suggested schema:

```python
Course:
    id: str
    title: str
    description: str
    units: int
    prerequisites: list[str]

Topic:
    name: str
    course_id: str
```

---

### Retrieval Layer

Use vector search over:

* Course title
* Course description
* Extracted topics

Natural language queries should be embedded and matched against course embeddings.

Example:

User:
"How do self-driving cars work?"

Relevant concepts:

* Robotics
* Computer Vision
* Machine Learning
* Control Systems
* State Estimation

Relevant courses should be surfaced automatically.

---

### Graph Layer

Represent prerequisites as a directed graph.

Example:

```
Linear Algebra
    ↓
Machine Learning
    ↓
Computer Vision
```

The graph should support:

* prerequisite expansion
* dependency traversal
* learning path generation

---

### LLM Responsibilities

The LLM should:

* Extract learning topics from user queries
* Generate course topics from descriptions
* Explain recommendations
* Construct learning paths

The LLM should not be responsible for storing knowledge or retrieving courses directly.

Retrieval should happen through embeddings and graph traversal.

---

## Development Principles

* Prefer simple solutions over complex ones.
* Keep components loosely coupled.
* Make retrieval deterministic when possible.
* Avoid hardcoded topic taxonomies.
* Build for future support of multiple universities.

---

## MVP

Input:

```
I want to learn about robotics.
```

Output:

```
Recommended Courses

1. Introduction to Robotics
2. Feedback Control Systems
3. Computer Vision

Suggested Learning Path

Linear Algebra
→ Programming
→ Control Systems
→ Robotics
→ Advanced Robotics
```

Success is defined as producing useful learning paths from free-form learning goals.

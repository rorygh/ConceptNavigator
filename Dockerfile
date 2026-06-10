FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy only what the ingest pipeline needs — changes to frontend files
# won't invalidate this layer or re-trigger the expensive embed step.
COPY ingest/ ./ingest/
COPY retrieval/ ./retrieval/
COPY llm/ ./llm/

# Build data artifacts into the image so startup is instant
RUN python -m ingest.fetch_mit && \
    python -m ingest.parse_courses && \
    python -m ingest.embed_courses

# Copy the rest of the app (api/, static files, etc.) in a separate layer.
# Frontend changes only bust from here — no re-ingest needed.
COPY api/ ./api/
COPY start.sh .

EXPOSE 8000
CMD ["./start.sh"]

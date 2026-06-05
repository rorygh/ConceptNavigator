#!/usr/bin/env bash
set -euo pipefail

DEST="/workspace/ConceptAtlas"

# Clone repo
if [ -d "$DEST" ]; then
    echo "==> $DEST already exists, skipping clone"
else
    echo "==> Cloning repo..."
    git clone "https://${RUNPOD_GITHUB_TOKEN}@github.com/rorygh/ConceptAtlas.git" "$DEST"
fi

cd "$DEST"

# Bootstrap data directory
mkdir -p data

# Install any updated dependencies
echo "==> Installing dependencies..."
uv pip install --system --no-cache -r requirements.txt

echo "==> Done. cd $DEST"
echo "==> Next: ensure RUNPOD_ANTHROPIC_API_KEY is set, then run the ingest pipeline."

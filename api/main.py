from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path

STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    from retrieval.search import _load
    _load()
    yield


app = FastAPI(lifespan=lifespan)


class SearchRequest(BaseModel):
    query: str
    n: int = 8


@app.post("/api/search")
def search(req: SearchRequest):
    from retrieval.search import search as _search
    results = _search(req.query, n=req.n)
    return {
        "courses": [
            {
                "id": c["id"],
                "title": c["title"],
                "description": c["description"],
                "units": c["units"],
                "level": c.get("level"),
            }
            for c in results
        ]
    }


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")

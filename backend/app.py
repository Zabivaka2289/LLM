"""FastAPI-сервер CoworkingFinder.

Запуск из корня репозитория:
    uvicorn backend.app:app --reload --port 8000
Открыть интерфейс: http://localhost:8000/
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .rag.llm import llm_mode
from .rag.pipeline import RAG

app = FastAPI(title="CoworkingFinder RAG", version="0.3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
rag = RAG()


class AskRequest(BaseModel):
    question: str = Field(..., max_length=1000)
    k: int = Field(5, ge=1, le=10)


@app.get("/api/health")
def health():
    return {"status": "ok", "documents": len(rag.docs), "llm_mode": llm_mode(), "text_mode": rag.text_mode}


@app.post("/api/ask")
@app.post("/ask")
def ask(request: AskRequest):
    """{question, k} → {answer, refused, sources, cited, mode, error}"""
    return rag.ask(request.question, request.k).to_dict()


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")

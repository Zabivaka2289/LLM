"""RAG-пайплайн: вопрос → BM25 → контекст → LLM → ответ с источниками."""
import re
from dataclasses import dataclass, field

from .bm25 import BM25Index, Hit
from .corpus import Document, load_corpus
from .llm import REFUSAL, LLMError, call_extractive, call_openai, llm_mode
from .text import analyze

SYSTEM_PROMPT = f"""Ты — консультант сервиса подбора коворкингов CoworkingFinder.
Отвечай на вопрос пользователя ТОЛЬКО по документам из контекста.
Правила:
1. Используй только сведения из контекста, ничего не додумывай и не добавляй от себя.
2. После каждого факта ставь ссылку на документ в квадратных скобках, например [D05].
3. Учитывай все условия вопроса (город, цена, время, размер команды) и называй только подходящие варианты.
4. Если в контексте нет ответа на вопрос, ответь ровно одной фразой: «{REFUSAL}»
5. Отвечай кратко, по-русски."""

CITE_RE = re.compile(r"\[(D\d{2})\]")


@dataclass
class Answer:
    answer: str
    refused: bool
    sources: list = field(default_factory=list)   # что вернул поиск (top-k)
    cited: list = field(default_factory=list)     # на что сослалась модель
    mode: str = ""
    error: str | None = None

    def to_dict(self):
        return self.__dict__.copy()


class RAG:
    def __init__(self, docs: dict[str, Document] | None = None, mode: str = "stem_stop",
                 k1: float = 1.2, b: float = 0.75, k: int = 5):
        self.docs = docs or load_corpus()
        self.text_mode = mode
        self.k = k
        self.index = BM25Index({d.id: d.full for d in self.docs.values()},
                               analyzer=lambda text: analyze(text, mode), k1=k1, b=b)

    # 1. Найти
    def retrieve(self, question: str, k: int | None = None) -> list[Hit]:
        return self.index.search(question, k or self.k)

    # 2. Собрать контекст: текст + идентификатор источника
    def build_context(self, hits: list[Hit]) -> str:
        return "\n\n".join(f"[{h.doc_id}] {self.docs[h.doc_id].full}" for h in hits)

    @staticmethod
    def build_messages(question: str, context: str) -> list[dict]:
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Вопрос: {question}\n\nКонтекст:\n{context}"},
        ]

    # 3. Вызвать LLM и вернуть {answer, sources}
    def ask(self, question: str, k: int | None = None) -> Answer:
        question = (question or "").strip()
        if not question:
            return Answer("Введите вопрос.", refused=True, mode="empty")
        hits = self.retrieve(question, k)
        sources = [self._source(h) for h in hits]
        mode = llm_mode()
        if not hits:  # нет ни одного совпадения — LLM не вызываем
            return Answer(REFUSAL, refused=True, sources=[], mode="no_hits")
        try:
            if mode == "openai":
                reply = call_openai(self.build_messages(question, self.build_context(hits)))
            else:
                reply = call_extractive(question, hits, self.docs, self.index)
        except LLMError as error:
            return Answer("Не удалось получить ответ от языковой модели. Попробуйте позже.",
                          refused=False, sources=sources, mode=mode, error=str(error))
        return Answer(reply, refused=is_refusal(reply), sources=sources,
                      cited=list(dict.fromkeys(CITE_RE.findall(reply))), mode=mode)

    def _source(self, hit: Hit) -> dict:
        doc = self.docs[hit.doc_id]
        return {"id": doc.id, "title": doc.title, "score": round(hit.score, 3),
                "text": doc.text,
                "matched": {w: round(c, 3) for w, c in sorted(hit.contributions.items(), key=lambda x: -x[1])}}


def is_refusal(reply: str) -> bool:
    text = reply.lower().replace("ё", "е")
    return "в документах нет" in text or "нет этой информации" in text or "нет информации" in text

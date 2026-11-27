"""Вызов LLM.

Режимы (переменная окружения LLM_MODE):
- "openai"     — любой OpenAI-совместимый Chat Completions API (OpenAI, OpenRouter,
                 локальная Ollama / LM Studio и т. п.). Настройки: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
- "extractive" — офлайн-заглушка без нейросети: выбирает из найденных документов
                 предложения со словами вопроса и ставит ссылки [Dxx]. Отказывается,
                 если в найденном тексте нет значимых слов вопроса. Нужна, чтобы система
                 и benchmark запускались без ключа и интернета.
- "auto" (по умолчанию) — "openai", если задан LLM_API_KEY или LLM_BASE_URL, иначе "extractive".
"""
import json
import os
import re
import urllib.error
import urllib.request
from math import log

from .text import analyze, STOPWORDS, tokens, stem

REFUSAL = "В документах нет этой информации."


class LLMError(RuntimeError):
    pass


def llm_mode() -> str:
    mode = os.getenv("LLM_MODE", "auto")
    if mode == "auto":
        return "openai" if (os.getenv("LLM_API_KEY") or os.getenv("LLM_BASE_URL")) else "extractive"
    return mode


def call_openai(messages: list[dict]) -> str:
    base = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL", "gpt-4o-mini")
    key = os.getenv("LLM_API_KEY", "")
    body = json.dumps({"model": model, "messages": messages, "temperature": 0}).encode()
    request = urllib.request.Request(
        f"{base}/chat/completions", data=body, method="POST",
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=float(os.getenv("LLM_TIMEOUT", "60"))) as response:
            data = json.load(response)
        return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, IndexError, TimeoutError, json.JSONDecodeError) as error:
        raise LLMError(f"LLM недоступна: {error}") from error


# ---------- офлайн-заглушка ----------

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
DEMO_LINE = re.compile(r"^Демонстрационные данные")


def call_extractive(question: str, hits: list, docs: dict, index, min_coverage: float = 0.75,
                    max_sentences: int = 4) -> str:
    """Отвечает цитатами из найденных документов или отказывается.

    Правило отказа: значимые слова вопроса (без служебных, после стемминга) должны
    встречаться в найденных документах; если покрыто меньше min_coverage, отвечаем отказом.
    Слова, встречающиеся в большинстве документов («коворкинг»), не учитываются —
    они ничего не говорят о том, есть ли ответ.
    """
    terms = [t for t in dict.fromkeys(analyze(question, "stem_stop"))]
    informative = [t for t in terms if len(index.index.get(t, {})) < index.N * 0.5]
    if not hits or not informative:
        return REFUSAL
    found = set()
    for hit in hits:
        found.update(analyze(docs[hit.doc_id].full, "stem_stop"))
    coverage = sum(t in found for t in informative) / len(informative)
    if coverage < min_coverage:
        return REFUSAL

    weights = {t: index.idf(t) for t in informative}
    candidates = []
    for rank, hit in enumerate(hits):
        for sentence in SENT_SPLIT.split(docs[hit.doc_id].text):
            sentence = sentence.strip()
            if not sentence or DEMO_LINE.match(sentence):
                continue
            words = set(analyze(sentence, "stem_stop"))
            score = sum(w for t, w in weights.items() if t in words)
            if score > 0:
                candidates.append((score, rank, sentence, hit.doc_id))
    if not candidates:
        return REFUSAL
    candidates.sort(key=lambda c: (-c[0], c[1]))
    lines = [f"— {s} [{d}]" for _, _, s, d in candidates[:max_sentences]]
    return "По найденным документам:\n" + "\n".join(lines)

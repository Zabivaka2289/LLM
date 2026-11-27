# Backend: RAG (BM25 + LLM)

Python 3.10+. Поиск и benchmark работают на стандартной библиотеке; FastAPI нужен только для HTTP-сервера.

## Структура
```
backend/
  rag/text.py      предобработка: токены, простой стемминг, служебные слова
  rag/bm25.py      свой BM25-индекс (обратный индекс слово → {документ: tf}, формула из методички)
  rag/corpus.py    загрузка corpus/D01–D30.md
  rag/llm.py       вызов LLM (OpenAI-совместимый API) и офлайн-заглушка
  rag/pipeline.py  retrieve → build_context → build_messages → llm → {answer, sources}
  app.py           FastAPI: POST /api/ask, GET /api/health, раздача frontend/
  ask.py           вопрос из терминала
```

## Запуск
```bash
pip install -r backend/requirements.txt
uvicorn backend.app:app --port 8000          # из корня репозитория
# открыть http://localhost:8000/
```
Вопрос из терминала (видно баллы BM25 и вклад каждого слова):
```bash
python -m backend.ask "Где есть бесплатная парковка?"
```

## LLM
| Переменная | По умолчанию | Смысл |
|---|---|---|
| `LLM_MODE` | `auto` | `openai` — вызывать LLM; `extractive` — офлайн-заглушка; `auto` — `openai`, если задан ключ или адрес |
| `LLM_API_KEY` | — | ключ API |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | любой OpenAI-совместимый адрес (OpenRouter, Ollama `http://localhost:11434/v1`, LM Studio) |
| `LLM_MODEL` | `gpt-4o-mini` | модель |

Инструкция модели (`SYSTEM_PROMPT` в `rag/pipeline.py`): отвечать только по контексту, ставить ссылки `[Dxx]`, учитывать все условия вопроса, а если ответа нет — ответить ровно «В документах нет этой информации.»

Если поиск не нашёл ни одного совпадения, LLM не вызывается и сразу возвращается отказ. Если LLM недоступна, возвращается сообщение об ошибке, остальные части приложения работают.

## API
`POST /api/ask` (также `/ask`)
```json
{ "question": "Где есть тихая зона?", "k": 5 }
```
Ответ:
```json
{
  "answer": "Тихие зоны есть в «Линии», «Параллели» и «Тишине» [D20].",
  "refused": false,
  "sources": [{ "id": "D20", "title": "Тихие зоны", "score": 9.41, "text": "…", "matched": { "тих": 3.1 } }],
  "cited": ["D20"],
  "mode": "openai",
  "error": null
}
```
`sources` — что вернул BM25 (top-k), `cited` — на какие документы сослался ответ.

## Параметры
Предобработка `stem_stop`, BM25 `k1 = 1.2`, `b = 0.75`, `k = 5`. Выбор — по `benchmark/README.md`.

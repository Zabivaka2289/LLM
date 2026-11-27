"""BM25-индекс, реализованный самостоятельно (без сторонних библиотек поиска).

Формула и параметры — как в методичке (занятие 3):
    IDF(t) = ln(1 + (N - df + 0.5) / (df + 0.5))
    BM25(q, d) = Σ_t IDF(t) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * L / avgdl))
Равные баллы упорядочиваются по ID документа.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
from math import log
from typing import Callable


@dataclass
class Hit:
    doc_id: str
    score: float
    contributions: dict  # слово -> вклад в балл (объяснимость)


class BM25Index:
    def __init__(self, docs: dict[str, str], analyzer: Callable[[str], list[str]],
                 k1: float = 1.2, b: float = 0.75):
        self.analyzer = analyzer
        self.k1, self.b = k1, b
        self.index: dict[str, dict[str, int]] = defaultdict(dict)  # слово -> {doc: tf}
        self.lengths: dict[str, int] = {}
        for doc, text in docs.items():
            words = analyzer(text)
            self.lengths[doc] = len(words)
            for word, tf in Counter(words).items():
                self.index[word][doc] = tf
        self.N = len(docs)
        self.avgdl = (sum(self.lengths.values()) / self.N) if self.N else 0.0

    def idf(self, word: str) -> float:
        df = len(self.index.get(word, {}))
        return log(1 + (self.N - df + 0.5) / (df + 0.5))

    def search(self, query: str, k: int = 5) -> list[Hit]:
        scores: dict[str, float] = defaultdict(float)
        parts: dict[str, dict[str, float]] = defaultdict(dict)
        for word in dict.fromkeys(self.analyzer(query)):  # каждое слово запроса один раз
            postings = self.index.get(word, {})
            if not postings:
                continue  # нет совпадений — вклад 0
            idf = self.idf(word)
            for doc, tf in postings.items():
                norm = self.k1 * (1 - self.b + self.b * self.lengths[doc] / self.avgdl)
                contribution = idf * tf * (self.k1 + 1) / (tf + norm)
                scores[doc] += contribution
                parts[doc][word] = contribution
        ranked = sorted(scores, key=lambda doc: (-scores[doc], doc))
        return [Hit(doc, scores[doc], parts[doc]) for doc in ranked[:k]]

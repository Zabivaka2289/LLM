"""Тесты BM25 и RAG-пайплайна:  python -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.rag.bm25 import BM25Index  # noqa: E402
from backend.rag.llm import REFUSAL  # noqa: E402
from backend.rag.pipeline import RAG, is_refusal  # noqa: E402
from backend.rag.text import analyze, tokens  # noqa: E402

SLIDE_DOCS = {"A": "Возврат оплаты на карту.", "B": "Статус оплаты в приложении.", "C": "Возврат билета через кассу."}


class SlideExample(unittest.TestCase):
    """Пример из методички: A = 0,940, B = C = 0,470, при k=2 берём A и B."""

    def setUp(self):
        self.index = BM25Index(SLIDE_DOCS, analyzer=tokens)

    def test_stats(self):
        self.assertEqual(self.index.N, 3)
        self.assertEqual(self.index.avgdl, 4)
        self.assertEqual(self.index.index["возврат"], {"A": 1, "C": 1})
        self.assertAlmostEqual(self.index.idf("возврат"), 0.470, places=3)

    def test_ranking(self):
        hits = self.index.search("Как происходит возврат оплаты?", k=3)
        self.assertEqual([h.doc_id for h in hits], ["A", "B", "C"])
        self.assertAlmostEqual(hits[0].score, 0.940, places=3)
        self.assertAlmostEqual(hits[1].score, 0.470, places=3)
        self.assertEqual([h.doc_id for h in self.index.search("Как происходит возврат оплаты?", k=2)], ["A", "B"])

    def test_no_match(self):
        self.assertEqual(self.index.search("вернуть деньги"), [])

    def test_tf_saturation(self):
        index = BM25Index({"X": "слово слово а б", "Y": "слово в г д", "Z": "е ж з и"}, analyzer=tokens)
        x, y = index.search("слово", k=2)
        self.assertAlmostEqual(x.score / y.score, 1.375, places=2)  # «2 раза → 1,38»


class Text(unittest.TestCase):
    def test_same_processing(self):
        self.assertEqual(analyze("в Москве"), analyze("Москва"))
        self.assertEqual(analyze("Возврат оплаты на карту.", "plain"), ["возврат", "оплаты", "на", "карту"])


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        os.environ["LLM_MODE"] = "extractive"
        cls.rag = RAG()

    def test_corpus(self):
        self.assertEqual(len(self.rag.docs), 30)

    def test_answer_has_sources(self):
        result = self.rag.ask("Где есть бесплатная парковка?")
        self.assertFalse(result.refused)
        self.assertTrue(result.sources)
        self.assertTrue(result.cited)

    def test_refusal(self):
        result = self.rag.ask("Можно ли прийти с собакой?")
        self.assertTrue(result.refused)
        self.assertEqual(result.answer, REFUSAL)

    def test_empty(self):
        self.assertTrue(self.rag.ask("   ").refused)

    def test_messages(self):
        hits = self.rag.retrieve("переговорная")
        messages = self.rag.build_messages("q", self.rag.build_context(hits))
        self.assertEqual([m["role"] for m in messages], ["system", "user"])
        self.assertIn(f"[{hits[0].doc_id}]", messages[1]["content"])
        self.assertTrue(is_refusal(REFUSAL))


if __name__ == "__main__":
    unittest.main()

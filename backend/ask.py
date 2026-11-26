"""Задать вопрос из терминала:  python -m backend.ask "Где есть бесплатная парковка?" [-k 5]"""
import argparse

from .rag.pipeline import RAG


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("question")
    parser.add_argument("-k", type=int, default=5)
    args = parser.parse_args()
    result = RAG().ask(args.question, args.k)
    print("Найдено BM25:")
    for s in result.sources:
        words = ", ".join(f"{w} {c}" for w, c in s["matched"].items())
        print(f"  {s['id']}  {s['score']:6.3f}  {s['title']}   ({words})")
    print(f"\nОтвет [{result.mode}]:\n{result.answer}")
    if result.error:
        print("Ошибка:", result.error)


if __name__ == "__main__":
    main()

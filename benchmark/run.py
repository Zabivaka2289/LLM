"""Прогон benchmark.

    python benchmark/run.py                      # основная конфигурация (stem_stop, k=5)
    python benchmark/run.py --compare            # сравнить версии поиска: plain / stem / stem_stop
    LLM_MODE=openai LLM_API_KEY=... python benchmark/run.py --tag gpt

Метрики:
  поиск (только 10 обычных вопросов): Recall@3, Recall@5, MRR@5;
  ответы: Accuracy (10 обычных) и Correct Rejection Rate (5 ловушек).
Ответ считается правильным, если он не отказ и содержит все факты must_include.
Результаты: benchmark/results/<tag>.json и benchmark/results/<tag>.md
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.rag.llm import llm_mode  # noqa: E402
from backend.rag.pipeline import RAG  # noqa: E402

QUESTIONS = json.loads((ROOT / "benchmark" / "questions.json").read_text(encoding="utf-8"))["questions"]
RESULTS = ROOT / "benchmark" / "results"
K_CONTEXT = 5


def recall_at(ranked, relevant, k):
    return len(set(ranked[:k]) & set(relevant)) / len(relevant)


def rr_at(ranked, relevant, k):
    for i, doc in enumerate(ranked[:k], 1):
        if doc in relevant:
            return 1 / i
    return 0.0


def normalize(text):
    text = text.lower().replace("ё", "е").replace(" ", " ")
    return re.sub(r"(?<=\d) (?=\d{3}\b)", "", text)  # «1 200» → «1200»


def facts_ok(answer, must):
    text = normalize(answer)
    missing = [m for m in must if not any(normalize(v) in text for v in m.split("|"))]
    return not missing, missing


def retrieval_metrics(rag):
    rows = []
    for q in QUESTIONS:
        if q["type"] != "normal":
            continue
        ranked = [h.doc_id for h in rag.retrieve(q["question"], 5)]
        rows.append((recall_at(ranked, q["relevant"], 3), recall_at(ranked, q["relevant"], 5),
                     rr_at(ranked, q["relevant"], 5)))
    n = len(rows)
    return {"recall@3": sum(r[0] for r in rows) / n, "recall@5": sum(r[1] for r in rows) / n,
            "mrr@5": sum(r[2] for r in rows) / n}


def run(tag, text_mode):
    rag = RAG(mode=text_mode, k=K_CONTEXT)
    items = []
    for q in QUESTIONS:
        result = rag.ask(q["question"], K_CONTEXT)
        ranked = [s["id"] for s in result.sources]
        item = {"id": q["id"], "type": q["type"], "question": q["question"], "retrieved": ranked,
                "scores": [s["score"] for s in result.sources], "answer": result.answer,
                "refused": result.refused, "cited": result.cited, "error": result.error}
        if q["type"] == "normal":
            ok, missing = facts_ok(result.answer, q["must_include"])
            item.update(relevant=q["relevant"], reference=q["reference"],
                        recall_at_3=recall_at(ranked, q["relevant"], 3),
                        recall_at_5=recall_at(ranked, q["relevant"], 5),
                        rr_at_5=rr_at(ranked, q["relevant"], 5),
                        correct=ok and not result.refused, missing_facts=missing)
        else:
            item.update(correct=result.refused)
        items.append(item)

    normal = [i for i in items if i["type"] == "normal"]
    traps = [i for i in items if i["type"] == "trap"]
    metrics = {
        "recall@3": sum(i["recall_at_3"] for i in normal) / len(normal),
        "recall@5": sum(i["recall_at_5"] for i in normal) / len(normal),
        "mrr@5": sum(i["rr_at_5"] for i in normal) / len(normal),
        "accuracy": sum(i["correct"] for i in normal) / len(normal),
        "correct_rejection_rate": sum(i["correct"] for i in traps) / len(traps),
    }
    config = {"tag": tag, "date": datetime.now().isoformat(timespec="seconds"), "text_mode": text_mode,
              "k1": rag.index.k1, "b": rag.index.b, "k": K_CONTEXT, "llm_mode": llm_mode(),
              "llm_model": os.getenv("LLM_MODEL") if llm_mode() == "openai" else None,
              "documents": len(rag.docs)}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{tag}.json").write_text(json.dumps({"config": config, "metrics": metrics, "items": items},
                                                    ensure_ascii=False, indent=2), encoding="utf-8")
    (RESULTS / f"{tag}.md").write_text(report(config, metrics, items), encoding="utf-8")
    return metrics


def report(config, metrics, items):
    lines = [f"# Результаты benchmark — `{config['tag']}`", "",
             f"Дата: {config['date']} · документов: {config['documents']} · предобработка: `{config['text_mode']}` · "
             f"BM25 k1={config['k1']}, b={config['b']} · top-k в контекст: {config['k']} · "
             f"LLM: `{config['llm_mode']}`{' / ' + config['llm_model'] if config['llm_model'] else ''}", "",
             "| Метрика | Значение |", "|---|---|"]
    names = {"recall@3": "Recall@3 (10 обычных)", "recall@5": "Recall@5 (10 обычных)", "mrr@5": "MRR@5 (10 обычных)",
             "accuracy": "Accuracy (10 обычных)", "correct_rejection_rate": "Correct Rejection Rate (5 ловушек)"}
    lines += [f"| {names[k]} | {v:.3f} |" for k, v in metrics.items()]
    lines += ["", "## Поиск и ответы по вопросам", "",
              "| ID | Найдено BM25 (top-5) | Релевантные | R@3 | R@5 | RR@5 | Ответ верен |", "|---|---|---|---|---|---|---|"]
    for i in items:
        if i["type"] == "normal":
            found = ", ".join(f"**{d}**" if d in i["relevant"] else d for d in i["retrieved"])
            lines.append(f"| {i['id']} | {found} | {', '.join(i['relevant'])} | {i['recall_at_3']:.2f} | "
                         f"{i['recall_at_5']:.2f} | {i['rr_at_5']:.2f} | {'✅' if i['correct'] else '❌'} |")
        else:
            lines.append(f"| {i['id']} (ловушка) | {', '.join(i['retrieved']) or '—'} | — | — | — | — | "
                         f"{'✅ отказ' if i['correct'] else '❌ нет отказа'} |")
    lines += ["", "## Ответы", ""]
    for i in items:
        lines += [f"### {i['id']}. {i['question']}", "", "```", i["answer"], "```"]
        if i["type"] == "normal":
            lines.append(f"Эталон: {i['reference']}")
            if i["missing_facts"]:
                lines.append(f"Не хватает фактов: {', '.join(i['missing_facts'])}")
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", default=None)
    parser.add_argument("--mode", default="stem_stop", choices=["plain", "stem", "stem_stop"])
    parser.add_argument("--compare", action="store_true", help="сравнить предобработку plain/stem/stem_stop")
    args = parser.parse_args()

    if args.compare:
        print("Сравнение версий поиска (корпус, вопросы и k одинаковые; меняется только предобработка):")
        print(f"{'режим':<10} {'Recall@3':>9} {'Recall@5':>9} {'MRR@5':>7}")
        rows = []
        for mode in ["plain", "stem", "stem_stop"]:
            m = retrieval_metrics(RAG(mode=mode))
            rows.append((mode, m))
            print(f"{mode:<10} {m['recall@3']:>9.3f} {m['recall@5']:>9.3f} {m['mrr@5']:>7.3f}")
        RESULTS.mkdir(exist_ok=True)
        md = ["# Сравнение версий поиска", "", "Корпус, вопросы и k одинаковые; меняется только предобработка текста.", "",
              "| Предобработка | Recall@3 | Recall@5 | MRR@5 |", "|---|---|---|---|"]
        md += [f"| `{mode}` | {m['recall@3']:.3f} | {m['recall@5']:.3f} | {m['mrr@5']:.3f} |" for mode, m in rows]
        (RESULTS / "compare_retrieval.md").write_text("\n".join(md) + "\n", encoding="utf-8")
        return

    tag = args.tag or f"{args.mode}_{llm_mode()}"
    metrics = run(tag, args.mode)
    for name, value in metrics.items():
        print(f"{name:<24} {value:.3f}")
    print(f"Подробно: benchmark/results/{tag}.md")


if __name__ == "__main__":
    main()

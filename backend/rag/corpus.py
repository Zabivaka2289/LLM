"""Загрузка корпуса: corpus/Dxx.md, первая строка `# Заголовок`. Один документ = один фрагмент."""
from dataclasses import dataclass
from pathlib import Path

CORPUS_DIR = Path(__file__).resolve().parents[2] / "corpus"


@dataclass
class Document:
    id: str
    title: str
    text: str  # без заголовка

    @property
    def full(self) -> str:
        return f"{self.title}\n{self.text}"


def load_corpus(path: Path = CORPUS_DIR) -> dict[str, Document]:
    docs = {}
    for file in sorted(Path(path).glob("D*.md")):
        lines = file.read_text(encoding="utf-8").strip().splitlines()
        title = lines[0].lstrip("# ").strip()
        body = "\n".join(l for l in lines[1:] if l.strip())
        docs[file.stem] = Document(file.stem, title, body)
    if not docs:
        raise FileNotFoundError(f"В {path} нет документов D*.md")
    return docs

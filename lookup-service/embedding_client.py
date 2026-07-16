import asyncio
import os

import numpy as np
from dotenv import load_dotenv
from fastembed import TextEmbedding

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

EMBEDDING_MODEL_NAME = os.environ.get(
    "EMBEDDING_MODEL_NAME", "BAAI/bge-small-en-v1.5"
)
EMBEDDING_CACHE_DIR = os.environ.get(
    "EMBEDDING_CACHE_DIR",
    os.path.join(os.environ.get("TMPDIR", "/tmp"), "fastembed-cache"),
)

_model: TextEmbedding | None = None
_error: str | None = None
_lock = asyncio.Lock()
_cache: dict[str, np.ndarray] = {}


async def get_embedding(text: str) -> np.ndarray:
    return (await get_embeddings([text]))[0]


async def get_embeddings(texts: list[str]) -> list[np.ndarray]:
    """Embed each unique text once per process with local ONNX inference."""
    global _model, _error
    if not texts:
        return []

    if _model is None and _error is None:
        async with _lock:
            if _model is None and _error is None:
                try:
                    _model = await asyncio.to_thread(
                        TextEmbedding,
                        model_name=EMBEDDING_MODEL_NAME,
                        cache_dir=EMBEDDING_CACHE_DIR,
                    )
                    print(f"FastEmbed ready: {EMBEDDING_MODEL_NAME}")
                except Exception as exc:
                    _error = str(exc)
                    print(f"FastEmbed unavailable; using BM25 only: {exc}")

    if _model is None:
        return [np.empty(0, dtype=np.float32) for _ in texts]

    missing = list(dict.fromkeys(text for text in texts if text and text not in _cache))
    try:
        if missing:
            vectors = await asyncio.to_thread(
                lambda: list(_model.embed(missing, batch_size=64))
            )
            _cache.update({
                text: np.asarray(vector, dtype=np.float32)
                for text, vector in zip(missing, vectors)
            })
        return [_cache.get(text, np.empty(0, dtype=np.float32)) for text in texts]
    except Exception as exc:
        _error = str(exc)
        print(f"FastEmbed failed; using BM25 only: {exc}")
        return [np.empty(0, dtype=np.float32) for _ in texts]

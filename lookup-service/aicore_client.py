import os
import asyncio
import httpx
import numpy as np
from fastembed import TextEmbedding
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

TOKEN_URL = os.environ.get("TOKEN_URL", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("CLIENT_SECRET", "")
MODEL_BASE_URL = os.environ.get("MODEL_BASE_URL", "")
EMBEDDING_MODEL_NAME = os.environ.get(
    "EMBEDDING_MODEL_NAME", "BAAI/bge-small-en-v1.5"
)
EMBEDDING_CACHE_DIR = os.environ.get(
    "EMBEDDING_CACHE_DIR",
    os.path.join(os.environ.get("TMPDIR", "/tmp"), "fastembed-cache"),
)

_token: str | None = None
_api_failed = False
_client = httpx.AsyncClient()
_token_lock = asyncio.Lock()
_embedding_model: TextEmbedding | None = None
_embedding_error: str | None = None
_embedding_lock = asyncio.Lock()

async def _get_token() -> str:
    global _token, _api_failed
    if _token or _api_failed:
        return _token or ""
    
    async with _token_lock:
        if _token or _api_failed:
            return _token or ""
            
        try:
            resp = await _client.post(
                TOKEN_URL, 
                auth=(CLIENT_ID, CLIENT_SECRET),
                data={"grant_type": "client_credentials"}
            )
            if resp.status_code == 200:
                _token = resp.json()["access_token"]
                return _token
        except Exception:
            pass
        _api_failed = True
        return ""

async def get_embedding(text: str) -> np.ndarray:
    """Return one local ONNX embedding, or an empty vector for BM25 fallback."""
    return (await get_embeddings([text]))[0]


async def get_embeddings(texts: list[str]) -> list[np.ndarray]:
    """Embed a batch locally with FastEmbed's ONNX runtime."""
    global _embedding_model, _embedding_error
    if not texts:
        return []

    if _embedding_model is None and _embedding_error is None:
        async with _embedding_lock:
            if _embedding_model is None and _embedding_error is None:
                try:
                    _embedding_model = await asyncio.to_thread(
                        TextEmbedding,
                        model_name=EMBEDDING_MODEL_NAME,
                        cache_dir=EMBEDDING_CACHE_DIR,
                    )
                    print(f"FastEmbed ready: {EMBEDDING_MODEL_NAME}")
                except Exception as exc:
                    _embedding_error = str(exc)
                    print(f"FastEmbed unavailable; using BM25 only: {exc}")

    if _embedding_model is None:
        return [np.empty(0, dtype=np.float32) for _ in texts]

    try:
        vectors = await asyncio.to_thread(
            lambda: list(_embedding_model.embed(texts, batch_size=64))
        )
        return [np.asarray(vector, dtype=np.float32) for vector in vectors]
    except Exception as exc:
        _embedding_error = str(exc)
        print(f"FastEmbed failed; using BM25 only: {exc}")
        return [np.empty(0, dtype=np.float32) for _ in texts]


async def adjudicate(description: str, top_candidates: list[dict]) -> str | None:
    token = await _get_token()
    if not token or not MODEL_BASE_URL:
        return top_candidates[0]["Code"] 

    prompt = f"Material Description: {description}\nCandidates:\n"
    for c in top_candidates:
        prompt += f"- {c['Code']}: {c['Description']}\n"
    prompt += "\nWhich candidate code is the best match? Reply with ONLY the 8-digit or 6-digit code."

    headers = {
        "Authorization": f"Bearer {token}",
        "AI-Resource-Group": "default",
        "Content-Type": "application/json"
    }
    
    url = f"{MODEL_BASE_URL}/chat/completions?api-version=2023-05-15"
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 10,
        "temperature": 0.0
    }
    
    try:
        resp = await _client.post(url, headers=headers, json=payload)
        if resp.status_code == 200:
            reply = resp.json()["choices"][0]["message"]["content"].strip()
            for c in top_candidates:
                if c["Code"] in reply:
                    return c["Code"]
    except Exception:
        pass
            
    return top_candidates[0]["Code"]

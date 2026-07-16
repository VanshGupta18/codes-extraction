import os
import json
import asyncio
import httpx
import numpy as np
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

TOKEN_URL = os.environ.get("TOKEN_URL", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("CLIENT_SECRET", "")
MODEL_BASE_URL = os.environ.get("MODEL_BASE_URL", "")
EMBEDDING_MODEL_BASE_URL = os.environ.get("EMBEDDING_MODEL_BASE_URL", "")

_token: str | None = None
_api_failed = False
_client = httpx.AsyncClient()
_token_lock = asyncio.Lock()

_cache_dir = os.environ.get("EMBEDDINGS_CACHE_DIR") or os.path.join(os.environ.get("TMPDIR", "/tmp"), "hsn-lookup")
os.makedirs(_cache_dir, exist_ok=True)
CACHE_FILE = os.path.join(_cache_dir, "embeddings_cache.json")

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_cache():
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump(_embeddings_cache, f)
    except OSError as exc:
        print(f"Warning: could not persist embedding cache: {exc}")

_embeddings_cache = load_cache()

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
    global _api_failed
    if not text:
        return np.zeros(1536)
        
    if text in _embeddings_cache:
        return np.array(_embeddings_cache[text])

    token = await _get_token()
    if token and not _api_failed and EMBEDDING_MODEL_BASE_URL:
        headers = {
            "Authorization": f"Bearer {token}",
            "AI-Resource-Group": "default",
            "Content-Type": "application/json"
        }
        url = f"{EMBEDDING_MODEL_BASE_URL}/embeddings?api-version=2023-05-15"
        payload = {"input": text, "model": "text-embedding-ada-002"}
        
        try:
            resp = await _client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                vec = np.array(resp.json()["data"][0]["embedding"])
                _embeddings_cache[text] = vec.tolist()
                save_cache()
                return vec
            elif resp.status_code == 404:
                _api_failed = True
        except Exception:
            _api_failed = True

    # Fallback to a normalized random vector if API fails (circuit broken)
    vec = np.random.rand(1536)
    vec = vec / np.linalg.norm(vec)
    return vec

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

"""
BM25 + embedding hybrid index for HSN/SAC candidate ranking.

Single entry point: Index.rank(description, query_embedding, ...)
- BM25 over full tokenized corpus (shared preprocessor)
- Optional cosine fusion when a real query embedding is provided
- Approved corpus boost (x1.3), material-group affinity boost (x1.2)
- Zero gate: returns [] when all scores are 0
- Relative confidence: rank-1 = 1.0, others scaled
"""
import numpy as np
from rank_bm25 import BM25Okapi
from text_preprocess import tokenize

_SERVICE_TYPES = {"DIEN", "SERV", "ZSER"}

# Fusion weights (BM25-norm + cosine)
_W_BM25 = 0.4
_W_COS = 0.6

# Number of top BM25 hits to consider for cosine fusion
_BM25_SHORTLIST = 50


class Index:
    def __init__(self, fallback_rows=None, fallback_affinity=None):
        self.rows = fallback_rows or []
        self.affinity = fallback_affinity or {}

        self._tokenized_corpus = [tokenize(r["Description"]) for r in self.rows]

        if self._tokenized_corpus:
            self.bm25 = BM25Okapi(self._tokenized_corpus)
        else:
            self.bm25 = None

        # Embedding matrix: zero-filled for govt rows; filled on approve
        embeddings = [r.get("Embedding", np.zeros(1536)) for r in self.rows]
        self._embeddings_matrix = np.array(embeddings, dtype=np.float32)
        self._normalize_embeddings()

        # Precompute valid code sets for fast validation
        self._build_code_sets()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def rank(
        self,
        description: str,
        query_embedding=None,
        material_group: str = None,
        tariff: str = "HSN",
        n: int = 3,
    ) -> list[dict]:
        """
        Return up to n candidates ranked by hybrid BM25+cosine score.

        Returns [] when no meaningful signal exists (zero gate).
        Each result dict has keys: Code, Description, confidence (0-1), Source.
        """
        if not self.rows or self.bm25 is None:
            return []

        tokens = tokenize(description)
        bm25_scores = self.bm25.get_scores(tokens).astype(np.float32)

        # rank_bm25 BM25Okapi can produce negative IDF when a term appears in
        # all documents — clamp to 0 so they don't corrupt normalization.
        np.clip(bm25_scores, 0.0, None, out=bm25_scores)

        # Zero out candidates from the wrong tariff type
        for i, row in enumerate(self.rows):
            source = row.get("Source", "GOVT_HSN")
            if source == "APPROVED":
                continue
            if tariff == "SAC" and source != "GOVT_SAC":
                bm25_scores[i] = 0.0
            elif tariff == "HSN" and source == "GOVT_SAC":
                bm25_scores[i] = 0.0

        # Take top-K shortlist by BM25
        k = min(_BM25_SHORTLIST, len(self.rows))
        shortlist_idx = np.argsort(bm25_scores)[::-1][:k]

        shortlist_bm25_max = float(bm25_scores[shortlist_idx[0]]) if k > 0 else 0.0

        # Build fused scores
        fused = np.zeros(len(self.rows), dtype=np.float32)

        has_embedding = False
        if query_embedding is not None:
            q = np.array(query_embedding, dtype=np.float32)
            q_norm = np.linalg.norm(q)
            if q_norm > 0:
                has_embedding = True
                q_unit = q / q_norm

        for idx in shortlist_idx:
            bm25_norm = (
                float(bm25_scores[idx]) / shortlist_bm25_max
                if shortlist_bm25_max > 0
                else 0.0
            )
            if has_embedding:
                row_emb = self._embeddings_norm[idx]
                cos = float(np.dot(row_emb, q_unit))
                fused[idx] = _W_BM25 * bm25_norm + _W_COS * max(cos, 0.0)
            else:
                fused[idx] = bm25_norm

        # Boosts (applied before normalization so they affect relative ranking)
        if material_group and material_group in self.affinity:
            chapter = self.affinity[material_group]
            for idx in shortlist_idx:
                if self.rows[idx]["Code"].startswith(chapter):
                    fused[idx] *= 1.2

        for idx in shortlist_idx:
            if self.rows[idx].get("Source") == "APPROVED":
                fused[idx] *= 1.3

        # Top-n by fused score
        top_n_idx = np.argsort(fused)[::-1][:n]
        top_score = float(fused[top_n_idx[0]])

        # Zero gate
        if top_score == 0.0:
            return []

        results = []
        for idx in top_n_idx:
            row = self.rows[idx]
            confidence = round(float(fused[idx]) / top_score, 4)
            results.append({
                "Code": row["Code"],
                "Description": row["Description"],
                "confidence": confidence,
                "Source": row.get("Source", "GOVT_HSN"),
            })
        return results

    def is_valid_code(self, code: str, material_type: str = "") -> bool:
        """Return True if code exists in the appropriate govt master."""
        tariff = "SAC" if (material_type or "").upper() in _SERVICE_TYPES else "HSN"
        if tariff == "SAC":
            return code in self._sac_codes
        return code in self._hsn_codes

    def add_document(self, row: dict, embedding=None):
        """Hot-reload: append one row to corpus and embedding matrix (called on approve)."""
        self.rows.append(row)
        self._tokenized_corpus.append(tokenize(row["Description"]))
        self.bm25 = BM25Okapi(self._tokenized_corpus)

        emb = np.array(embedding if embedding is not None else np.zeros(1536), dtype=np.float32)
        emb_norm = emb / (np.linalg.norm(emb) or 1.0)
        self._embeddings_matrix = np.vstack([self._embeddings_matrix, emb[np.newaxis]])
        self._embeddings_norm = np.vstack([self._embeddings_norm, emb_norm[np.newaxis]])

        # Keep approved code set current
        if row.get("Source") == "APPROVED" and row.get("Code"):
            self._hsn_codes.add(row["Code"])

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _normalize_embeddings(self):
        norms = np.linalg.norm(self._embeddings_matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        self._embeddings_norm = self._embeddings_matrix / norms

    def _build_code_sets(self):
        self._hsn_codes: set = set()
        self._sac_codes: set = set()
        for row in self.rows:
            source = row.get("Source", "")
            code = row.get("Code", "")
            if source == "GOVT_HSN":
                self._hsn_codes.add(code)
            elif source == "GOVT_SAC":
                self._sac_codes.add(code)

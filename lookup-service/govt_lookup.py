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

        # Only shortlisted rows are embedded; avoid a large zero-filled matrix.
        self._embeddings: dict[int, np.ndarray] = {}

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

        bm25_scores = self._bm25_scores(description, tariff)
        shortlist_idx = self.shortlist_indices(
            description, tariff=tariff, k=_BM25_SHORTLIST
        )
        if len(shortlist_idx) == 0:
            return []

        shortlist_bm25_max = float(bm25_scores[shortlist_idx[0]])

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
            row_emb = self._embeddings.get(idx)
            if has_embedding and row_emb is not None and row_emb.shape == q_unit.shape:
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
        ranked_idx = [
            int(index)
            for index in np.argsort(fused)[::-1]
            if fused[index] > 0 and self._allowed_for_tariff(self.rows[index], tariff)
        ][:n]

        # Zero gate
        if not ranked_idx:
            return []
        top_score = float(fused[ranked_idx[0]])

        results = []
        for idx in ranked_idx:
            row = self.rows[idx]
            confidence = round(float(fused[idx]) / top_score, 4)
            results.append({
                "Code": row["Code"],
                "Description": row["Description"],
                "confidence": confidence,
                "Source": row.get("Source", "GOVT_HSN"),
            })
        return results

    def shortlist_indices(
        self, description: str, tariff: str = "HSN", k: int = _BM25_SHORTLIST
    ) -> list[int]:
        """Return valid top-K BM25 row indexes for lazy embedding."""
        if not self.rows or self.bm25 is None:
            return []
        scores = self._bm25_scores(description, tariff)
        valid = [
            int(index)
            for index in np.argsort(scores)[::-1]
            if self._allowed_for_tariff(self.rows[index], tariff)
        ]
        return valid[: min(k, len(valid))]

    def set_embeddings(self, indices: list[int], embeddings: list) -> None:
        """Cache normalized vectors for shortlisted rows."""
        for index, embedding in zip(indices, embeddings):
            vector = np.asarray(embedding, dtype=np.float32)
            norm = np.linalg.norm(vector)
            if vector.ndim == 1 and vector.size and norm > 0:
                self._embeddings[index] = vector / norm

    def is_valid_code(self, code: str, material_type: str = "") -> bool:
        """Return True if code exists in the appropriate govt master."""
        tariff = "SAC" if (material_type or "").upper() in _SERVICE_TYPES else "HSN"
        if tariff == "SAC":
            return code in self._sac_codes
        return code in self._hsn_codes

    def add_document(self, row: dict, embedding=None):
        """Hot-reload one approved row and its optional embedding."""
        self.rows.append(row)
        self._tokenized_corpus.append(tokenize(row["Description"]))
        self.bm25 = BM25Okapi(self._tokenized_corpus)

        if embedding is not None:
            vector = np.asarray(embedding, dtype=np.float32)
            norm = np.linalg.norm(vector)
            if vector.ndim == 1 and vector.size and norm > 0:
                self._embeddings[len(self.rows) - 1] = vector / norm

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

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

    def _allowed_for_tariff(self, row: dict, tariff: str) -> bool:
        source = row.get("Source", "")
        code = row.get("Code", "")
        if source == "GOVT_SAC":
            return tariff == "SAC"
        if source == "GOVT_HSN":
            return tariff == "HSN"
        if source == "APPROVED":
            valid_codes = self._sac_codes if tariff == "SAC" else self._hsn_codes
            return code in valid_codes
        return False

    def _bm25_scores(self, description: str, tariff: str) -> np.ndarray:
        scores = self.bm25.get_scores(tokenize(description)).astype(np.float32)
        # BM25Okapi can produce negative IDF for ubiquitous terms.
        np.clip(scores, 0.0, None, out=scores)
        for index, row in enumerate(self.rows):
            if not self._allowed_for_tariff(row, tariff):
                scores[index] = 0.0
        return scores

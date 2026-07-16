"""
BM25 + HANA cosine hybrid index for HSN/SAC candidate ranking.

Corpus embeddings live in HANA (TariffCorpusEmbedding). This module keeps
BM25 tokenized corpus in memory and fuses with cosine scores from CAP.
"""
import numpy as np
from rank_bm25 import BM25Okapi
from text_preprocess import tokenize

_SERVICE_TYPES = {"DIEN", "SERV", "ZSER"}

_W_BM25 = 0.4
_W_COS = 0.6
_BM25_SHORTLIST = 50


def sources_for_tariff(tariff: str) -> list[str]:
    if tariff == "SAC":
        return ["GOVT_SAC", "APPROVED"]
    return ["GOVT_HSN", "APPROVED"]


class Index:
    def __init__(self, fallback_rows=None, fallback_affinity=None):
        self.rows = fallback_rows or []
        self.affinity = fallback_affinity or {}
        self._tokenized_corpus = [tokenize(r["Description"]) for r in self.rows]
        self.bm25 = BM25Okapi(self._tokenized_corpus) if self._tokenized_corpus else None
        self._build_code_sets()

    def rank(
        self,
        description: str,
        query_embedding=None,
        cosine_scores: dict | None = None,
        material_group: str = None,
        tariff: str = "HSN",
        n: int = 3,
    ) -> list[dict]:
        if not self.rows or self.bm25 is None:
            return []

        cosine_scores = cosine_scores or {}
        bm25_scores = self._bm25_scores(description, tariff)
        shortlist_idx = self.shortlist_indices(description, tariff=tariff, k=_BM25_SHORTLIST)
        if not shortlist_idx:
            return []

        shortlist_bm25_max = float(bm25_scores[shortlist_idx[0]])
        fused = np.zeros(len(self.rows), dtype=np.float32)

        has_embedding = False
        q_unit = None
        if query_embedding is not None:
            q = np.array(query_embedding, dtype=np.float32)
            q_norm = np.linalg.norm(q)
            if q_norm > 0:
                has_embedding = True
                q_unit = q / q_norm

        for idx in shortlist_idx:
            row = self.rows[idx]
            bm25_norm = (
                float(bm25_scores[idx]) / shortlist_bm25_max
                if shortlist_bm25_max > 0
                else 0.0
            )
            cos_key = (row.get("Source"), row["Code"])
            cos = float(cosine_scores.get(cos_key, cosine_scores.get(row["Code"], 0.0)))
            if has_embedding and cos > 0:
                fused[idx] = _W_BM25 * bm25_norm + _W_COS * max(cos, 0.0)
            else:
                fused[idx] = bm25_norm

        if material_group and material_group in self.affinity:
            chapter = self.affinity[material_group]
            for idx in shortlist_idx:
                if self.rows[idx]["Code"].startswith(chapter):
                    fused[idx] *= 1.2

        for idx in shortlist_idx:
            if self.rows[idx].get("Source") == "APPROVED":
                fused[idx] *= 1.3

        ranked_idx = [
            int(index)
            for index in np.argsort(fused)[::-1]
            if fused[index] > 0 and self._allowed_for_tariff(self.rows[index], tariff)
        ][:n]

        if not ranked_idx:
            return []
        top_score = float(fused[ranked_idx[0]])

        return [
            {
                "Code": self.rows[idx]["Code"],
                "Description": self.rows[idx]["Description"],
                "confidence": round(float(fused[idx]) / top_score, 4),
                "Source": self.rows[idx].get("Source", "GOVT_HSN"),
            }
            for idx in ranked_idx
        ]

    def shortlist_indices(self, description: str, tariff: str = "HSN", k: int = _BM25_SHORTLIST) -> list[int]:
        if not self.rows or self.bm25 is None:
            return []
        scores = self._bm25_scores(description, tariff)
        valid = [
            int(index)
            for index in np.argsort(scores)[::-1]
            if self._allowed_for_tariff(self.rows[index], tariff)
        ]
        return valid[: min(k, len(valid))]

    def shortlist_codes_and_sources(self, description: str, tariff: str = "HSN", k: int = _BM25_SHORTLIST) -> tuple[list[str], list[str], list[int]]:
        indices = self.shortlist_indices(description, tariff=tariff, k=k)
        codes = [self.rows[i]["Code"] for i in indices]
        sources = list(dict.fromkeys(self.rows[i]["Source"] for i in indices))
        return codes, sources, indices

    def is_valid_code(self, code: str, material_type: str = "") -> bool:
        tariff = "SAC" if (material_type or "").upper() in _SERVICE_TYPES else "HSN"
        if tariff == "SAC":
            return code in self._sac_codes
        return code in self._hsn_codes

    def add_document(self, row: dict):
        """Hot-reload one approved row into BM25 corpus."""
        self.rows.append(row)
        self._tokenized_corpus.append(tokenize(row["Description"]))
        self.bm25 = BM25Okapi(self._tokenized_corpus)

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
        np.clip(scores, 0.0, None, out=scores)
        for index, row in enumerate(self.rows):
            if not self._allowed_for_tariff(row, tariff):
                scores[index] = 0.0
        return scores

import numpy as np
from rank_bm25 import BM25Okapi
from abbreviations import expand

class Index:
    def __init__(self, fallback_rows=None, fallback_affinity=None):
        self.rows = fallback_rows or []
        self.affinity = fallback_affinity or {}

        self.corpus = [r["Description"].lower() for r in self.rows]
        self.tokenized_corpus = [doc.split(" ") for doc in self.corpus]

        if self.tokenized_corpus:
            self.bm25 = BM25Okapi(self.tokenized_corpus)
            embeddings = [r.get("Embedding", np.zeros(1536)) for r in self.rows]
            self.embeddings_matrix = np.array(embeddings)
            norms = np.linalg.norm(self.embeddings_matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1
            self.embeddings_norm = self.embeddings_matrix / norms
        else:
            self.bm25 = None
            self.embeddings_matrix = np.empty((0, 1536))
            self.embeddings_norm = np.empty((0, 1536))

    def top_matches_bm25(self, description: str, material_group: str = None, n: int = 3, tariff: str = "HSN") -> list[dict]:
        if not self.rows:
            return []

        tokenized_query = expand(description).lower().split(" ")
        bm25_scores = self.bm25.get_scores(tokenized_query)

        for i, row in enumerate(self.rows):
            source = row.get("Source", "GOVT")
            code = row["Code"]
            if source != "APPROVED":
                if tariff == "SAC" and source != "GOVT_SAC":
                    bm25_scores[i] = 0
                elif tariff == "HSN" and source == "GOVT_SAC":
                    bm25_scores[i] = 0

        if material_group and material_group in self.affinity:
            affinity_chapter = self.affinity[material_group]
            for i, row in enumerate(self.rows):
                if row["Code"].startswith(affinity_chapter):
                    bm25_scores[i] *= 1.20

        top_indices = np.argsort(bm25_scores)[::-1][:n]

        results = []
        for idx in top_indices:
            row = self.rows[idx]
            results.append({
                "Code": row["Code"],
                "Description": row["Description"],
                "score": round(float(bm25_scores[idx]), 2),
                "Source": row.get("Source", "GOVT"),
            })
        return results

    def top_matches(self, description: str, embedding, material_group: str = None, n: int = 3) -> list[dict]:
        if not self.rows:
            return []

        tokenized_query = expand(description).lower().split(" ")
        bm25_scores = self.bm25.get_scores(tokenized_query)

        q = np.array(embedding)
        q_norm = np.linalg.norm(q)
        if q_norm > 0:
            q = q / q_norm
        else:
            q = np.zeros(1536)

        cos_sim = np.dot(self.embeddings_norm, q)
        hybrid_scores = bm25_scores + (cos_sim * 10)

        if material_group and material_group in self.affinity:
            affinity_chapter = self.affinity[material_group]
            for i, row in enumerate(self.rows):
                if row["Code"].startswith(affinity_chapter):
                    hybrid_scores[i] *= 1.20

        top_indices = np.argsort(hybrid_scores)[::-1][:n]

        results = []
        for idx in top_indices:
            row = self.rows[idx]
            results.append({
                "Code": row["Code"],
                "Description": row["Description"],
                "score": round(float(hybrid_scores[idx]), 2),
                "Source": row.get("Source", "GOVT"),
            })
        return results

    def add_document(self, row: dict):
        self.rows.append(row)
        desc = row["Description"].lower()
        self.corpus.append(desc)
        self.tokenized_corpus.append(desc.split(" "))

        self.bm25 = BM25Okapi(self.tokenized_corpus)

        emb = row.get("Embedding", np.zeros(1536))
        emb_norm = emb / (np.linalg.norm(emb) or 1)

        self.embeddings_matrix = np.vstack([self.embeddings_matrix, emb])
        self.embeddings_norm = np.vstack([self.embeddings_norm, emb_norm])

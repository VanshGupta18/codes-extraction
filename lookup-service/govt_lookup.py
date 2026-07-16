import os
from hdbcli import dbapi

HANA_HOST = os.environ.get("HANA_HOST")
HANA_PORT = int(os.environ.get("HANA_PORT", "39015"))
HANA_USER = os.environ.get("HANA_USER")
HANA_PASSWORD = os.environ.get("HANA_PASSWORD")

def _get_hana_conn():
    if not HANA_HOST:
        return None
    return dbapi.connect(
        address=HANA_HOST,
        port=HANA_PORT,
        user=HANA_USER,
        password=HANA_PASSWORD
    )

class Index:
    def __init__(self, fallback_rows=None, fallback_affinity=None):
        self.fallback_rows = fallback_rows or []
        self.fallback_affinity = fallback_affinity or {}

    def top_matches(self, description: str, embedding, material_group: str = None, n: int = 3) -> list[dict]:
        conn = _get_hana_conn()
        if not conn:
            # Local fallback (mock) if HANA is not configured
            return self._fallback_top_matches(description, embedding, material_group, n)

        cursor = conn.cursor()
        try:
            emb_str = f"[{','.join(map(str, embedding.tolist()))}]"
            
            # Using HANA Vector Engine (VECTOR_SIMILARITY) and HANA Full Text Search (SCORE())
            # We select from our Govt Tables and Approved Classifications
            query = f"""
                SELECT TOP {n}
                    c."CODE",
                    c."DESCRIPTION",
                    VECTOR_SIMILARITY(e."EMBEDDING", TO_REAL_VECTOR(?)) AS "COS_SIM",
                    SCORE() AS "FTS_SCORE"
                FROM "ALL_CANDIDATES_VIEW" c
                JOIN "HSN_MATERIALEMBEDDINGS" e ON c."CODE" = e."MATERIALNUMBER"
                WHERE CONTAINS(c."DESCRIPTION", ?, EXACT)
                ORDER BY ("COS_SIM" * 10 + "FTS_SCORE") DESC
            """
            cursor.execute(query, (emb_str, description))
            results = []
            for row in cursor.fetchall():
                score = round(float(row[2] * 10 + row[3]), 2)
                # Material Group Boosting Logic can be done here or in SQL
                results.append({
                    "Code": row[0],
                    "Description": row[1],
                    "score": score
                })
            return results
        finally:
            cursor.close()
            conn.close()

    def _fallback_top_matches(self, description, embedding, material_group, n):
        # Fallback to a mock response if run locally without HANA
        return [
            {"Code": "MOCK1", "Description": "HANA Not Configured", "score": 9.99},
            {"Code": "MOCK2", "Description": "HANA Not Configured", "score": 8.88}
        ]

    def add_document(self, row: dict):
        pass # Handled by Event Mesh in production

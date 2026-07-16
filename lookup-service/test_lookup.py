"""
Lookup service regression tests.

Unit tests (no server required) exercise:
  - Shared tokenization
  - Hybrid BM25 rank: relative confidence, zero gate
  - Self-learning hot-reload
  - Code validation gate

Integration smoke tests (server at localhost:8000) exercise the full pipeline.
"""
import numpy as np
import httpx

# ---------------------------------------------------------------------------
# Unit tests — no HTTP server required
# ---------------------------------------------------------------------------

from text_preprocess import tokenize
from govt_lookup import Index


def test_tokenize_strips_punctuation():
    tokens = tokenize("CABLE, BATTERY")
    assert "cable" in tokens, f"expected 'cable' in {tokens}"
    assert "battery" in tokens, f"expected 'battery' in {tokens}"
    # Comma must NOT be attached to any token
    assert all("," not in t for t in tokens), f"punctuation leaked into tokens: {tokens}"


def test_tokenize_expands_abbreviations():
    tokens = tokenize("BRKT RR BUMPER")
    assert "bracket" in tokens, f"expected 'bracket' in {tokens}"
    assert "rear" in tokens, f"expected 'rear' in {tokens}"


def test_tokenize_empty():
    assert tokenize("") == []
    assert tokenize("   ") == []


def _make_index():
    """Build a small in-memory index for unit testing."""
    rows = [
        {"Code": "85444200", "Description": "CABLE ELECTRIC BATTERY", "Source": "GOVT_HSN"},
        {"Code": "87088000", "Description": "SUSPENSION SHOCK ABSORBER SPRING", "Source": "GOVT_HSN"},
        {"Code": "87081090", "Description": "BUMPER BRACKET ASSEMBLY REAR FRONT", "Source": "GOVT_HSN"},
        {"Code": "991111",   "Description": "CONSULTING SERVICE SOFTWARE", "Source": "GOVT_SAC"},
    ]
    return Index(fallback_rows=rows)


def test_bm25_nonzero_for_punctuated_desc():
    idx = _make_index()
    results = idx.rank("CABLE, BATTERY")
    assert results, "expected at least one candidate for 'CABLE, BATTERY'"
    assert results[0]["Code"] == "85444200", f"expected cable code first: {results}"


def test_rank1_confidence_is_1():
    idx = _make_index()
    results = idx.rank("SUSPENSION SHOCK ABSORBER")
    assert results, "expected at least one candidate"
    assert results[0]["confidence"] == 1.0, f"rank-1 confidence should be 1.0: {results[0]}"


def test_relative_confidence_ordering():
    idx = _make_index()
    results = idx.rank("BUMPER BRACKET ASSEMBLY")
    assert results, f"expected at least one candidate: {results}"
    for i in range(len(results) - 1):
        assert results[i]["confidence"] >= results[i + 1]["confidence"], (
            f"confidence not descending: {results}"
        )
    assert all(result["confidence"] > 0 for result in results)
    assert results[0]["confidence"] == 1.0


def test_zero_gate_returns_empty():
    idx = _make_index()
    # Complete gibberish — no token overlap with corpus
    results = idx.rank("XYZXYZ QQQQQQ NNNNN")
    assert results == [], f"expected empty list for zero-match query, got: {results}"


def test_tariff_filter_hsn_excludes_sac():
    idx = _make_index()
    results = idx.rank("CONSULTING SERVICE", tariff="HSN")
    assert all(r["Code"] != "991111" for r in results), (
        f"SAC code should not appear in HSN results: {results}"
    )


def test_tariff_filter_sac_excludes_hsn():
    idx = _make_index()
    results = idx.rank("CONSULTING SERVICE SOFTWARE", tariff="SAC")
    assert any(r["Code"] == "991111" for r in results), (
        f"SAC code should appear in SAC results: {results}"
    )


def test_approved_boost_ranks_higher():
    """Approved corpus entry should rank above govt entry when BM25 is equal."""
    # Use diverse descriptions so BM25 IDF is positive (terms not in every doc)
    rows = [
        {"Code": "85444200", "Description": "CABLE ELECTRIC POWER UNIT", "Source": "GOVT_HSN"},
        {"Code": "87088000", "Description": "SUSPENSION SHOCK ABSORBER SPRING", "Source": "GOVT_HSN"},
        {"Code": "85444200", "Description": "CABLE ELECTRIC BATTERY", "Source": "APPROVED",
         "MaterialNumber": "M001"},
    ]
    idx = Index(fallback_rows=rows)
    results = idx.rank("CABLE ELECTRIC BATTERY")
    assert results, "expected at least one result"
    assert results[0]["Source"] == "APPROVED", (
        f"approved entry should rank first due to x1.3 boost: {results}"
    )


def test_self_learning_hot_reload():
    """After add_document, the new approved row should surface for similar query."""
    idx = _make_index()

    # Before: query matches govt row
    before = idx.rank("CABLE BATTERY ELECTRIC")
    assert before, "expected results before adding approved"
    codes_before = [r["Code"] for r in before]

    # Hot-reload an approved entry with same description
    idx.add_document({
        "Code": "85444200",
        "Description": "CABLE BATTERY ELECTRIC",
        "Source": "APPROVED",
        "MaterialNumber": "M999",
    })

    # After: approved entry should rank at top
    after = idx.rank("CABLE BATTERY ELECTRIC")
    assert after, "expected results after hot-reload"
    assert after[0]["Source"] == "APPROVED", (
        f"hot-reloaded approved entry should rank first: {after}"
    )


def test_is_valid_code():
    idx = _make_index()
    assert idx.is_valid_code("85444200", "ERSA") is True
    assert idx.is_valid_code("99999999", "ERSA") is False
    assert idx.is_valid_code("991111", "DIEN") is True
    assert idx.is_valid_code("85444200", "DIEN") is False


def test_hybrid_bm25_only_when_zero_embedding():
    """Passing an all-zero embedding should degrade to BM25-only (not crash)."""
    idx = _make_index()
    zero_emb = np.zeros(1536)
    results_hybrid = idx.rank("CABLE BATTERY", query_embedding=zero_emb)
    results_bm25 = idx.rank("CABLE BATTERY")
    assert results_hybrid == results_bm25, (
        "zero embedding should produce identical results to BM25-only path"
    )


def test_hybrid_cosine_changes_ranking():
    """A semantic candidate can outrank the lexical leader after lazy embedding."""
    idx = _make_index()
    shortlist = idx.shortlist_indices("CABLE BATTERY")
    query = np.zeros(1536)
    query[0] = 1.0
    vectors = []
    semantic_code = "87088000"
    for index in shortlist:
        vector = np.zeros(1536)
        vector[0 if idx.rows[index]["Code"] == semantic_code else 1] = 1.0
        vectors.append(vector)
    idx.set_embeddings(shortlist, vectors)

    results = idx.rank("CABLE BATTERY", query_embedding=query)
    assert results[0]["Code"] == semantic_code, (
        f"cosine signal should change rank-1: {results}"
    )


# Run unit tests
_tests = [
    test_tokenize_strips_punctuation,
    test_tokenize_expands_abbreviations,
    test_tokenize_empty,
    test_bm25_nonzero_for_punctuated_desc,
    test_rank1_confidence_is_1,
    test_relative_confidence_ordering,
    test_zero_gate_returns_empty,
    test_tariff_filter_hsn_excludes_sac,
    test_tariff_filter_sac_excludes_hsn,
    test_approved_boost_ranks_higher,
    test_self_learning_hot_reload,
    test_is_valid_code,
    test_hybrid_bm25_only_when_zero_embedding,
    test_hybrid_cosine_changes_ranking,
]

print("Running unit tests...")
for t in _tests:
    t()
    print(f"  PASS  {t.__name__}")
print(f"Unit tests: {len(_tests)} passed.\n")

# ---------------------------------------------------------------------------
# Integration smoke tests — requires server at localhost:8000
# ---------------------------------------------------------------------------

BASE_URL = "http://localhost:8000"

try:
    httpx.get(f"{BASE_URL}/health", timeout=3).raise_for_status()
except Exception:
    print("Server not reachable — skipping integration tests.")
    raise SystemExit(0)

print("Running integration smoke tests...")


def rank(mat: str):
    httpx.post(f"{BASE_URL}/rank/{mat}", timeout=120).raise_for_status()


# 1. Suspension / shock absorber
rank("MAT-3001")
r = httpx.get(f"{BASE_URL}/candidates/MAT-3001").json()
assert r["candidates"], "expected at least one candidate for MAT-3001"
top = r["candidates"][0]
assert top["Code"] == "87088000", f"unexpected top code: {top}"
assert 0.0 < top["score"] <= 1.0, f"score out of 0-1 range: {top}"
print(f"  PASS  MAT-3001 top={top['Code']} score={top['score']:.2f}")

# 2. Abbreviated description — BRKT RR BUMPER
rank("MAT-3002")
r = httpx.get(f"{BASE_URL}/candidates/MAT-3002").json()
assert any(c["Code"].startswith("870810") for c in r["candidates"]), (
    f"bumper-family code not found: {r['candidates']}"
)
print(f"  PASS  MAT-3002 bumper family found")

# 3. Self-learning: approve MAT-3002, re-rank — should favour approved code
httpx.post(f"{BASE_URL}/approve",
           json={"materialNumber": "MAT-3002", "chosenCode": "87081090"},
           timeout=30).raise_for_status()
rank("MAT-3002")
r2 = httpx.get(f"{BASE_URL}/candidates/MAT-3002").json()
assert r2["candidates"][0]["Code"] == "87081090", (
    f"self-learning re-rank failed: {r2['candidates']}"
)
print(f"  PASS  self-learning re-rank for MAT-3002")

# 4. Rank-1 confidence should be 1.0 (or very close after DB round-trip)
assert r2["candidates"][0]["score"] >= 0.99, (
    f"rank-1 score should be ~1.0: {r2['candidates'][0]}"
)
print(f"  PASS  rank-1 score ≈ 1.0")

print("\nALL TESTS PASSED")

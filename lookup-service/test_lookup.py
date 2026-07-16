import httpx

BASE_URL = "http://localhost:8000"

# 1. Clean case: top candidate should be the real suspension/shock-absorber code
r = httpx.get(f"{BASE_URL}/candidates/MAT-3001").json()
assert r["candidates"], "expected at least one candidate for MAT-3001"
assert r["candidates"][0]["Code"] == "87088000", r

# 2. Abbreviated case: BRKT RR BUMPER should still surface a bumper-family code via
#    ancestor enrichment + abbreviation expansion, even though the leaf text alone
#    never mentions "bumper"
r = httpx.get(f"{BASE_URL}/candidates/MAT-3002").json()
assert any(c["Code"].startswith("870810") for c in r["candidates"]), r

# 3. Approve MAT-3002, then re-query: it should now come back via the self-learned
#    ApprovedClassifications corpus, not the govt table
httpx.post(f"{BASE_URL}/approve", json={"materialNumber": "MAT-3002", "chosenCode": "87081090"}).raise_for_status()
r2 = httpx.get(f"{BASE_URL}/candidates/MAT-3002").json()
assert r2["candidates"][0]["Source"] == "APPROVED", r2

print("PASS: clean match / abbreviation+ancestor match / self-learning re-match all verified")

import httpx

BASE_URL = "http://localhost:8000"

def rank(mat: str):
    httpx.post(f"{BASE_URL}/rank/{mat}", timeout=120).raise_for_status()

# 1. Clean case: top candidate should be the real suspension/shock-absorber code
rank("MAT-3001")
r = httpx.get(f"{BASE_URL}/candidates/MAT-3001").json()
assert r["candidates"], "expected at least one candidate for MAT-3001"
assert r["candidates"][0]["Code"] == "87088000", r

# 2. Abbreviated case: BRKT RR BUMPER should still surface a bumper-family code
rank("MAT-3002")
r = httpx.get(f"{BASE_URL}/candidates/MAT-3002").json()
assert any(c["Code"].startswith("870810") for c in r["candidates"]), r

# 3. Approve MAT-3002, re-rank: should now match via self-learned ApprovedClassifications corpus
httpx.post(f"{BASE_URL}/approve", json={"materialNumber": "MAT-3002", "chosenCode": "87081090"}).raise_for_status()
rank("MAT-3002")
r2 = httpx.get(f"{BASE_URL}/candidates/MAT-3002").json()
assert r2["candidates"][0]["Code"] == "87081090", r2

print("PASS: batch rank / abbreviation match / self-learning re-rank all verified")

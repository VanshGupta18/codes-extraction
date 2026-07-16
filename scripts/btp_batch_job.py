import asyncio
import httpx
import sys

CAP_URL = "http://localhost:4004/odata/v4/hsn"
FASTAPI_URL = "http://localhost:8000"

async def process_batch():
    async with httpx.AsyncClient() as client:
        print("1. Fetching pending materials (dummy HSN 9999) from legacy table...")
        resp = await client.get(f"{CAP_URL}/ZMM_MAT_LEGACY?$filter=HSN%20eq%20'9999'")
        if resp.status_code != 200:
            print(f"Error fetching legacy data: {resp.text}")
            sys.exit(1)
        
        pending_items = resp.json().get("value", [])
        print(f"Found {len(pending_items)} pending items.")
        
        for item in pending_items:
            mat_num = item["Material"]
            print(f"\nProcessing {mat_num}...")
            
            # Call lookup service to generate top 3 candidates
            c_resp = await client.get(f"{FASTAPI_URL}/candidates/{mat_num}")
            if c_resp.status_code != 200:
                print(f"Warning: Could not generate candidates for {mat_num} ({c_resp.status_code})")
                continue
            
            candidates = c_resp.json().get("candidates", [])
            
            # Post each candidate to CandidateSuggestions table in CAP
            for rank, c in enumerate(candidates, start=1):
                payload = {
                    "MaterialNumber": mat_num,
                    "Rank": rank,
                    "CandidateCode": c["Code"],
                    "Score": float(c["score"])
                }
                post_resp = await client.post(f"{CAP_URL}/CandidateSuggestions", json=payload)
                if post_resp.status_code not in (200, 201):
                    # It might already exist if we re-run the job, which is fine for a prototype,
                    # but let's ignore duplicate key errors silently.
                    if "already exists" not in post_resp.text:
                        print(f"Error posting candidate: {post_resp.text}")
                else:
                    print(f"  Saved rank {rank}: {c['Code']} (score: {payload['Score']})")

if __name__ == "__main__":
    asyncio.run(process_batch())

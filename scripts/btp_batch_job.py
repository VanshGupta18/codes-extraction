import asyncio
import os
import httpx
import sys

LOOKUP_URL = os.environ.get("LOOKUP_URL", "http://localhost:8000")

async def process_batch():
    async with httpx.AsyncClient(timeout=600) as client:
        print("Triggering batch pipeline on lookup service...")
        resp = await client.post(f"{LOOKUP_URL}/trigger_batch")
        if resp.status_code != 200:
            print(f"Error triggering batch: {resp.text}")
            sys.exit(1)
        print(resp.json()["message"])
        print("Batch runs in background. Poll CandidateSuggestions in CAP or refresh the UI.")

if __name__ == "__main__":
    asyncio.run(process_batch())

import asyncio
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import cap_client
import govt_lookup
import aicore_client

app = FastAPI(title="HSN Suggestion Service")
_index: govt_lookup.Index | None = None
_index_error: str | None = None
_index_lock = asyncio.Lock()

def _normalize_rows(raw: list[dict], code_key: str = "Code") -> list[dict]:
    rows = []
    for row in raw:
        code = row.get(code_key) or row.get("HSN")
        desc = row.get("Description")
        if code and desc:
            rows.append({"Code": str(code), "Description": desc, **({"MaterialNumber": row["MaterialNumber"]} if "MaterialNumber" in row else {})})
    return rows

async def _build_index():
    global _index, _index_error
    print("Loading search index from CAP...")

    for attempt in range(1, 31):
        try:
            approved_raw = await cap_client.get_approved_classifications()
            approved = _normalize_rows([a for a in approved_raw if a.get("HSN")], code_key="HSN")
            hsn_rows = _normalize_rows(await cap_client.get_govt_hsn())
            sac_rows = _normalize_rows(await cap_client.get_govt_sac())
            mara = await cap_client.get_mara()

            approved_numbers = {a["MaterialNumber"] for a in approved if "MaterialNumber" in a}
            affinity = {}
            for mat in mara:
                mat_group = mat.get("MaterialGroup")
                if mat_group and mat.get("MaterialNumber") in approved_numbers:
                    appr = next((a for a in approved if a.get("MaterialNumber") == mat["MaterialNumber"]), None)
                    if appr:
                        affinity[mat_group] = appr["Code"][:4]

            all_rows = approved + hsn_rows + sac_rows
            print(f"Building BM25 index over {len(all_rows)} rows (embeddings loaded lazily per request)...")

            async with _index_lock:
                _index = govt_lookup.Index(fallback_rows=all_rows, fallback_affinity=affinity)
                _index_error = None
            print("Search engine ready.")
            return
        except Exception as exc:
            _index_error = str(exc)
            print(f"Index build attempt {attempt}/30 failed: {exc}")
            await asyncio.sleep(10)

    print("Search index failed to build after 30 attempts.")

@app.on_event("startup")
async def startup():
    asyncio.create_task(_build_index())

@app.get("/health")
async def health():
    if _index:
        return {"status": "ready", "documents": len(_index.rows)}
    if _index_error:
        return {"status": "starting", "lastError": _index_error}
    return {"status": "starting"}

class ApproveRequest(BaseModel):
    materialNumber: str
    chosenCode: str

@app.get("/candidates/{material_number}")
async def candidates(material_number: str):
    if not _index:
        raise HTTPException(503, _index_error or "Index not ready")

    description, material_group = await cap_client.get_legacy_material_details(material_number)
    if description is None:
        raise HTTPException(404, f"Legacy Data: no description for material '{material_number}'")

    query_emb = await aicore_client.get_embedding(description)
    top_cands = _index.top_matches(description, query_emb, material_group=material_group, n=3)

    if len(top_cands) >= 2:
        score_diff = top_cands[0]["score"] - top_cands[1]["score"]
        if score_diff < 1.0:
            winner_code = await aicore_client.adjudicate(description, top_cands)
            if winner_code and winner_code != top_cands[0]["Code"]:
                winner_idx = next((i for i, c in enumerate(top_cands) if c["Code"] == winner_code), -1)
                if winner_idx != -1:
                    top_cands.insert(0, top_cands.pop(winner_idx))

    return {
        "materialNumber": material_number,
        "description": description,
        "candidates": top_cands,
    }

async def async_index_update(row: dict):
    row["Embedding"] = await aicore_client.get_embedding(row["Description"])
    if _index:
        _index.add_document(row)

@app.post("/approve")
async def approve(req: ApproveRequest, background_tasks: BackgroundTasks):
    description, _ = await cap_client.get_legacy_material_details(req.materialNumber)
    if description is None:
        raise HTTPException(404, f"Legacy Data: no description for material '{req.materialNumber}'")

    await cap_client.approve_classification(req.materialNumber, description, req.chosenCode)

    new_doc = {
        "MaterialNumber": req.materialNumber,
        "Code": req.chosenCode,
        "Description": description
    }
    background_tasks.add_task(async_index_update, new_doc)

    return {"materialNumber": req.materialNumber, "hsn": req.chosenCode}

async def run_batch_job():
    print("1. Fetching pending materials (dummy HSN 9999) from legacy table...")
    async with httpx.AsyncClient(base_url=cap_client.CAP_BASE_URL) as client:
        resp = await client.get("/ZMM_MAT_LEGACY?$filter=HSN%20eq%20'9999'")
        if resp.status_code != 200:
            print(f"Error fetching legacy data: {resp.text}")
            return

        pending_items = resp.json().get("value", [])
        unique_materials = list(set(item["Material"] for item in pending_items))
        print(f"Found {len(unique_materials)} unique pending materials.")

        for mat_num in unique_materials:
            print(f"\nProcessing {mat_num}...")
            try:
                res = await candidates(mat_num)
                top_cands = res["candidates"]

                for rank, c in enumerate(top_cands, start=1):
                    payload = {
                        "MaterialNumber": mat_num,
                        "Rank": rank,
                        "CandidateCode": c["Code"],
                        "Score": float(c["score"])
                    }
                    post_resp = await client.post("/CandidateSuggestions", json=payload)
                    if post_resp.status_code not in (200, 201):
                        if "already exists" not in post_resp.text:
                            print(f"Error posting candidate: {post_resp.text}")
                    else:
                        print(f"  Saved rank {rank}: {c['Code']} (score: {payload['Score']})")
            except Exception as e:
                print(f"Warning: Could not generate candidates for {mat_num} ({e})")
        print("Batch processing complete!")

@app.post("/trigger_batch")
async def trigger_batch(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_batch_job)
    return {"message": "Batch job started in background"}

import asyncio
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import cap_client
import govt_lookup
import aicore_client

app = FastAPI(title="HSN Suggestion Service")
_index: govt_lookup.Index | None = None

@app.on_event("startup")
async def startup():
    global _index
    print("Loading initial data from CAP...")
    
    # 1. Fetch tables
    approved = await cap_client.get_approved_classifications()
    hsn_rows = await cap_client.get_govt_hsn()
    sac_rows = await cap_client.get_govt_sac()
    
    # 2. Build Material Group affinity
    mara = await cap_client.get_mara()
    affinity = {}
    for mat in mara:
        mat_group = mat.get("MaterialGroup")
        if mat_group and mat["MaterialNumber"] in [a["MaterialNumber"] for a in approved]:
            appr = next((a for a in approved if a["MaterialNumber"] == mat["MaterialNumber"]), None)
            if appr:
                # Store the 4-digit chapter heading
                affinity[mat_group] = appr["Code"][:4]

    all_rows = approved + hsn_rows + sac_rows

    # 3. Generate embeddings for all initial rows
    print(f"Fetching embeddings for {len(all_rows)} rows...")
    async def fetch_emb(r):
        r["Embedding"] = await aicore_client.get_embedding(r["Description"])
        
    chunk_size = 500
    for i in range(0, len(all_rows), chunk_size):
        await asyncio.gather(*(fetch_emb(r) for r in all_rows[i:i+chunk_size]))
    print("Finished embeddings!")

    # 4. Initialize the search index
    _index = govt_lookup.Index(fallback_rows=all_rows, fallback_affinity=affinity)
    print("Search engine ready.")

class ApproveRequest(BaseModel):
    materialNumber: str
    chosenCode: str

@app.get("/candidates/{material_number}")
async def candidates(material_number: str):
    if not _index:
        raise HTTPException(503, "Index not ready")
        
    description, material_group = await cap_client.get_material_details(material_number)
    if description is None:
        raise HTTPException(404, f"MAKT: no description for material '{material_number}'")
        
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
    # Fetch embedding then append to index
    row["Embedding"] = await aicore_client.get_embedding(row["Description"])
    if _index:
        _index.add_document(row)

@app.post("/approve")
async def approve(req: ApproveRequest, background_tasks: BackgroundTasks):
    description, _ = await cap_client.get_material_details(req.materialNumber)
    if description is None:
        raise HTTPException(404, f"MAKT: no description for material '{req.materialNumber}'")
        
    # Write to CAP database
    await cap_client.approve_classification(req.materialNumber, description, req.chosenCode)
    
    # Trigger background index rebuild
    new_doc = {
        "MaterialNumber": req.materialNumber,
        "Code": req.chosenCode,
        "Description": description
    }
    background_tasks.add_task(async_index_update, new_doc)
    
    return {"materialNumber": req.materialNumber, "hsn": req.chosenCode}

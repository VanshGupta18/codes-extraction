import asyncio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import cap_client
import govt_lookup
import aicore_client
import event_listener

app = FastAPI(title="HSN Suggestion Service (BTP Production)")
_index: govt_lookup.Index | None = None

@app.on_event("startup")
async def startup():
    global _index
    # The index is now stateless, connecting to HANA dynamically
    _index = govt_lookup.Index()
    # Start listening to SAP Event Mesh in a background thread
    event_listener.start_background()

class ApproveRequest(BaseModel):
    materialNumber: str
    chosenCode: str

@app.get("/candidates/{material_number}")
async def candidates(material_number: str):
    description, material_group = await cap_client.get_material_details(material_number)
    if description is None:
        raise HTTPException(404, f"MAKT: no description for material '{material_number}'")
        
    # Get embedding (uses Redis cache)
    query_emb = await aicore_client.get_embedding(description)
    
    # Delegate hybrid scoring to HANA Vector Engine
    top_cands = _index.top_matches(description, query_emb, material_group=material_group, n=3)
    
    # AI Adjudication for close ties
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

@app.post("/approve")
async def approve(req: ApproveRequest):
    description, _ = await cap_client.get_material_details(req.materialNumber)
    if description is None:
        raise HTTPException(404, f"MAKT: no description for material '{req.materialNumber}'")
        
    # Simply write to DB. CAP will emit TariffApproved to Event Mesh.
    # The event_listener thread will pick it up and update HANA vectors.
    await cap_client.approve_classification(req.materialNumber, description, req.chosenCode)
    
    return {"materialNumber": req.materialNumber, "hsn": req.chosenCode}

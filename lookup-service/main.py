import asyncio
import os
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import cap_client
import govt_lookup
import aicore_client

app = FastAPI(title="HSN Suggestion Service")
_index: govt_lookup.Index | None = None
_index_error: str | None = None
_index_lock = asyncio.Lock()

ENABLE_EMBEDDINGS = os.environ.get("ENABLE_EMBEDDINGS", "").lower() in ("1", "true", "yes")

def _normalize_rows(raw: list[dict], code_key: str = "Code", source: str = "GOVT") -> list[dict]:
    rows = []
    for row in raw:
        code = row.get(code_key) or row.get("HSN")
        desc = row.get("Description")
        if code and desc:
            normalized = {"Code": str(code), "Description": desc, "Source": source}
            if row.get("MaterialNumber"):
                normalized["MaterialNumber"] = row["MaterialNumber"]
            rows.append(normalized)
    return rows

async def _build_index():
    global _index, _index_error
    print("Loading BM25 search index from CAP...")

    for attempt in range(1, 31):
        try:
            approved_raw = await cap_client.get_approved_classifications()
            approved = _normalize_rows([a for a in approved_raw if a.get("HSN")], code_key="HSN", source="APPROVED")
            hsn_rows = _normalize_rows(await cap_client.get_govt_hsn(), source="GOVT_HSN")
            sac_rows = _normalize_rows(await cap_client.get_govt_sac(), source="GOVT_SAC")
            mara = await cap_client.get_mara()

            approved_by_mat = {a["MaterialNumber"]: a["Code"] for a in approved if "MaterialNumber" in a}
            affinity = {}
            for mat in mara:
                mat_num = mat.get("MaterialNumber")
                mat_group = mat.get("MaterialGroup")
                if mat_group and mat_num in approved_by_mat:
                    affinity[mat_group] = approved_by_mat[mat_num][:4]

            all_rows = approved + hsn_rows + sac_rows
            print(f"BM25 index ready over {len(all_rows)} reference rows.")

            async with _index_lock:
                _index = govt_lookup.Index(fallback_rows=all_rows, fallback_affinity=affinity)
                _index_error = None
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
        return {"status": "ready", "documents": len(_index.rows), "embeddings": ENABLE_EMBEDDINGS}
    if _index_error:
        return {"status": "starting", "lastError": _index_error}
    return {"status": "starting"}

class ApproveRequest(BaseModel):
    materialNumber: str
    chosenCode: str

def _extend_index(row: dict):
    if _index:
        _index.add_document({**row, "Source": "APPROVED"})

async def _rank_material(material_number: str) -> dict:
    if not _index:
        raise HTTPException(503, _index_error or "Index not ready")

    details = await cap_client.get_material_details(material_number)
    if details is None:
        raise HTTPException(404, f"No material master (MARA/MAKT) or legacy description for '{material_number}'")

    description = details["Description"]
    material_group = details.get("MaterialGroup")
    # MARA MaterialType selects govt reference: goods → HSN, services → SAC
    service_types = {"DIEN", "SERV", "ZSER"}
    mat_type = (details.get("MaterialType") or "").upper()
    tariff = "SAC" if mat_type in service_types else "HSN"

    top_cands = _index.top_matches_bm25(description, material_group=material_group, n=3, tariff=tariff)

    if ENABLE_EMBEDDINGS and len(top_cands) >= 2:
        query_emb = await aicore_client.get_embedding(description)
        top_cands = _index.top_matches(description, query_emb, material_group=material_group, n=3)
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
        "materialGroup": material_group,
        "materialType": details.get("MaterialType"),
        "candidates": top_cands,
    }

async def _rank_and_save(material_number: str) -> dict:
    result = await _rank_material(material_number)
    await cap_client.save_candidate_suggestions(material_number, result["candidates"])
    return result

@app.post("/rank/{material_number}")
async def rank_material(material_number: str):
    """Rank one pending material (BM25) and persist top-3 to CandidateSuggestions."""
    return await _rank_and_save(material_number)

@app.get("/candidates/{material_number}")
async def get_candidates(material_number: str, refresh: bool = False):
    """Return precomputed candidates from CAP. Use ?refresh=true to re-rank and save."""
    if refresh:
        return await _rank_and_save(material_number)

    rows = await cap_client.get_candidate_suggestions(material_number)
    if not rows:
        raise HTTPException(
            404,
            f"No precomputed candidates for '{material_number}'. Run batch pipeline or POST /rank/{material_number}.",
        )

    details = await cap_client.get_material_details(material_number)
    return {
        "materialNumber": material_number,
        "description": details["Description"] if details else None,
        "candidates": [
            {"Code": r["CandidateCode"], "score": float(r["Score"]), "Rank": r["Rank"]}
            for r in rows
        ],
    }

@app.post("/approve")
async def approve(req: ApproveRequest):
    details = await cap_client.get_material_details(req.materialNumber)
    if details is None:
        raise HTTPException(404, f"No material master (MARA/MAKT) or legacy data for '{req.materialNumber}'")

    description = details["Description"]
    await cap_client.approve_classification(req.materialNumber, description, req.chosenCode)

    _extend_index({
        "MaterialNumber": req.materialNumber,
        "Code": req.chosenCode,
        "Description": description,
    })

    return {"materialNumber": req.materialNumber, "hsn": req.chosenCode}

async def run_batch_job():
    if not _index:
        print(f"Batch aborted: index not ready ({_index_error})")
        return

    try:
        material_numbers = await cap_client.get_pending_material_numbers()
    except Exception as exc:
        print(f"Batch aborted: could not read pending queue from CAP ({exc})")
        return

    print(f"Batch: ranking {len(material_numbers)} pending materials (BM25)...")

    ok, failed = 0, 0
    for mat_num in material_numbers:
        try:
            result = await _rank_and_save(mat_num)
            top = result["candidates"][0]["Code"] if result["candidates"] else "—"
            print(f"  {mat_num}: saved {len(result['candidates'])} candidates (top: {top})")
            ok += 1
        except Exception as exc:
            print(f"  {mat_num}: failed ({exc})")
            failed += 1

    print(f"Batch complete: {ok} ranked, {failed} failed.")

@app.post("/trigger_batch")
async def trigger_batch(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_batch_job)
    return {"message": "Batch job started. Results will appear in CandidateSuggestions."}

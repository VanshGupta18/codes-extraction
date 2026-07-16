"""
HSN Suggestion Service

Source-of-truth rules:
  - Valid HSN/SAC codes     → GovtHSNMaster / GovtSACMaster (only codes here can be suggested)
  - Material description    → MARA + MAKT (EN) — legacy description as last-resort fallback
  - Work queue              → ZMM_MAT_LEGACY where HSN = '9999'

Ranking: hybrid BM25 (lexical) + cosine embedding (semantic).
  - BM25 index built at startup (fast, no API cost)
  - Query embedding fetched per-call, cached in /tmp
  - When AI Core unavailable, degrades gracefully to BM25-only
Self-learning: every approved classification is hot-reloaded into the index.
"""
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

_SERVICE_TYPES = {"DIEN", "SERV", "ZSER"}


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
            approved = _normalize_rows(
                [a for a in approved_raw if a.get("HSN")],
                code_key="HSN",
                source="APPROVED",
            )
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
            print(f"BM25 index ready: {len(all_rows)} rows "
                  f"({len(approved)} approved, {len(hsn_rows)} HSN, {len(sac_rows)} SAC).")

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
        return {
            "status": "ready",
            "documents": len(_index.rows),
            "hsn_codes": len(_index._hsn_codes),
            "sac_codes": len(_index._sac_codes),
        }
    if _index_error:
        return {"status": "starting", "lastError": _index_error}
    return {"status": "starting"}


class ApproveRequest(BaseModel):
    materialNumber: str
    chosenCode: str


def _tariff_for(material_type: str) -> str:
    return "SAC" if (material_type or "").upper() in _SERVICE_TYPES else "HSN"


async def _rank_material(material_number: str) -> dict:
    if not _index:
        raise HTTPException(503, _index_error or "Index not ready")

    details = await cap_client.get_material_details(material_number)
    if details is None:
        raise HTTPException(404, f"No material master (MARA/MAKT) or legacy description for '{material_number}'")

    description = details["Description"]
    material_group = details.get("MaterialGroup")
    material_type = details.get("MaterialType") or ""
    tariff = _tariff_for(material_type)

    # Always attempt embedding; zeros returned when AI Core is unavailable → BM25-only path
    query_embedding = await aicore_client.get_embedding(description)

    candidates = _index.rank(
        description,
        query_embedding=query_embedding,
        material_group=material_group,
        tariff=tariff,
        n=3,
    )

    return {
        "materialNumber": material_number,
        "description": description,
        "materialGroup": material_group,
        "materialType": material_type,
        "candidates": candidates,
    }


async def _rank_and_save(material_number: str) -> dict:
    result = await _rank_material(material_number)
    await cap_client.clear_candidate_suggestions(material_number)
    await cap_client.save_candidate_suggestions(material_number, result["candidates"])
    return result


@app.post("/rank/{material_number}")
async def rank_material(material_number: str):
    """Rank one pending material and persist top-3 to CandidateSuggestions."""
    return await _rank_and_save(material_number)


@app.get("/candidates/{material_number}")
async def get_candidates(material_number: str, refresh: bool = False):
    """Return precomputed candidates from CAP. Use ?refresh=true to re-rank."""
    if refresh:
        return await _rank_and_save(material_number)

    rows = await cap_client.get_candidate_suggestions(material_number)
    if not rows:
        raise HTTPException(
            404,
            f"No precomputed candidates for '{material_number}'. "
            f"Run batch or POST /rank/{material_number}.",
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
    if not _index:
        raise HTTPException(503, _index_error or "Index not ready")

    details = await cap_client.get_material_details(req.materialNumber)
    if details is None:
        raise HTTPException(404, f"No material master or legacy data for '{req.materialNumber}'")

    material_type = details.get("MaterialType") or ""

    # Validate chosen code against govt master (single truth for valid HSN/SAC)
    if not _index.is_valid_code(req.chosenCode, material_type):
        tariff = _tariff_for(material_type)
        raise HTTPException(
            400,
            f"Code '{req.chosenCode}' is not a valid {tariff} code in the government master."
        )

    description = details["Description"]
    await cap_client.approve_classification(req.materialNumber, description, req.chosenCode)

    # Hot-reload: embed approved description and extend in-memory index
    embedding = await aicore_client.get_embedding(description)
    _index.add_document(
        {
            "MaterialNumber": req.materialNumber,
            "Code": req.chosenCode,
            "Description": description,
            "Source": "APPROVED",
        },
        embedding=embedding,
    )

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

    print(f"Batch: ranking {len(material_numbers)} pending materials...")

    ok, skipped_zero, failed = 0, 0, 0
    for mat_num in material_numbers:
        try:
            result = await _rank_and_save(mat_num)
            if result["candidates"]:
                top = result["candidates"][0]["Code"]
                conf = result["candidates"][0]["confidence"]
                print(f"  {mat_num}: {len(result['candidates'])} candidates, top={top} ({conf:.0%})")
                ok += 1
            else:
                print(f"  {mat_num}: no match (all scores zero — skipped)")
                skipped_zero += 1
        except Exception as exc:
            print(f"  {mat_num}: failed ({exc})")
            failed += 1

    print(
        f"Batch complete: {ok} ranked, {skipped_zero} no-match, {failed} errors. "
        f"Total: {len(material_numbers)}."
    )


@app.post("/trigger_batch")
async def trigger_batch(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_batch_job)
    return {"message": "Batch job started. Results will appear in CandidateSuggestions."}

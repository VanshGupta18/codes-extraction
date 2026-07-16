"""
HSN Suggestion Service — HTTP API (rank, approve, health).

Corpus embeddings are stored in HANA (TariffCorpusEmbedding).
Batch and full index builds run via CF worker: python -m jobs.run_batch
"""
import asyncio

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import cap_client
import embedding_client
import ranking_core
from ranking_core import tariff_for

app = FastAPI(title="HSN Suggestion Service")


@app.on_event("startup")
async def startup():
    asyncio.create_task(ranking_core.build_index())


@app.get("/health")
async def health():
    index = ranking_core.get_index()
    if index:
        vector_count = 0
        last_index_build = ""
        try:
            vector_count = await cap_client.count_tariff_embeddings()
            last_index_build = await cap_client.get_system_metadata("embedding_index_built_at")
        except Exception as exc:
            last_index_build = f"error: {exc}"

        return {
            "status": "ready",
            "documents": len(index.rows),
            "hsn_codes": len(index._hsn_codes),
            "sac_codes": len(index._sac_codes),
            "hana_vector_count": vector_count,
            "embedding_index_built_at": last_index_build,
            "embedding_model": embedding_client.EMBEDDING_MODEL_NAME,
            "embeddings": (
                "error"
                if embedding_client._error
                else "ready" if embedding_client._model else "lazy"
            ),
            "embedding_cache_entries": len(embedding_client._cache),
        }

    err = ranking_core.get_index_error()
    if err:
        return {"status": "starting", "lastError": err}
    return {"status": "starting"}


class ApproveRequest(BaseModel):
    materialNumber: str
    chosenCode: str


@app.post("/rank/{material_number}")
async def rank_material(material_number: str):
    try:
        return await ranking_core.rank_and_save(material_number)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/candidates/{material_number}")
async def get_candidates(material_number: str, refresh: bool = False):
    if refresh:
        try:
            return await ranking_core.rank_and_save(material_number)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

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
    index = ranking_core.get_index()
    if not index:
        raise HTTPException(503, ranking_core.get_index_error() or "Index not ready")

    details = await cap_client.get_material_details(req.materialNumber)
    if details is None:
        raise HTTPException(404, f"No material master or legacy data for '{req.materialNumber}'")

    material_type = details.get("MaterialType") or ""
    if not index.is_valid_code(req.chosenCode, material_type):
        tariff = tariff_for(material_type)
        raise HTTPException(
            400,
            f"Code '{req.chosenCode}' is not a valid {tariff} code in the government master.",
        )

    description = details["Description"]
    await cap_client.approve_classification(req.materialNumber, description, req.chosenCode)

    index.add_document({
        "MaterialNumber": req.materialNumber,
        "Code": req.chosenCode,
        "Description": description,
        "Source": "APPROVED",
    })
    await ranking_core.upsert_approved_embedding(req.chosenCode, description)

    return {"materialNumber": req.materialNumber, "hsn": req.chosenCode}


@app.post("/trigger_batch")
async def trigger_batch():
    return {
        "message": (
            "Batch is not run in the API process. "
            "Use: python -m jobs.run_batch (BAS) or "
            "cf run-task hsn-lookup-worker --command \"python -m jobs.run_batch\""
        ),
    }

import os
from urllib.parse import quote
import httpx

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "http://localhost:4004/odata/v4/hsn")

async def get_all(entity: str, params: dict | None = None) -> list[dict]:
    query = {"$top": 20000, **(params or {})}
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        resp = await client.get(f"/{entity}", params=query)
    resp.raise_for_status()
    return resp.json().get("value", [])

async def get_approved_classifications():
    return await get_all("ApprovedClassifications")

async def get_govt_hsn():
    return await get_all("GovtHSNMaster")

async def get_govt_sac():
    return await get_all("GovtSACMaster")

async def get_mara():
    return await get_all("MARA")

async def get_makt():
    return await get_all("MAKT", {"$filter": "Language eq 'EN'"})

async def get_legacy_materials():
    return await get_all("ZMM_MAT_LEGACY")

async def _get_mara_row(client: httpx.AsyncClient, material_number: str) -> dict | None:
    enc = quote(material_number, safe="")
    resp = await client.get(f"/MARA(MaterialNumber='{enc}')")
    if resp.status_code != 200:
        return None
    return resp.json()

async def _get_makt_description(client: httpx.AsyncClient, material_number: str) -> str | None:
    enc = quote(material_number, safe="")
    filter_expr = quote(f"MaterialNumber eq '{material_number}' and Language eq 'EN'", safe="")
    resp = await client.get(f"/MAKT?$filter={filter_expr}&$top=1")
    if resp.status_code != 200 or not resp.json().get("value"):
        return None
    return resp.json()["value"][0].get("Description")

async def _get_legacy_fallback(client: httpx.AsyncClient, material_number: str) -> tuple[str | None, str | None, str | None]:
    filter_expr = quote(f"Material eq '{material_number}'", safe="")
    resp = await client.get(f"/ZMM_MAT_LEGACY?$filter={filter_expr}&$top=1")
    if resp.status_code != 200 or not resp.json().get("value"):
        return None, None, None
    row = resp.json()["value"][0]
    return row.get("Material_Description"), row.get("Material_Group"), row.get("Material_Type")

async def get_material_details(material_number: str) -> dict | None:
    """MARA + MAKT are source of truth; legacy queue is fallback for manual ingest only."""
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        mara = await _get_mara_row(client, material_number)
        description = await _get_makt_description(client, material_number)
        material_group = mara.get("MaterialGroup") if mara else None
        material_type = mara.get("MaterialType") if mara else None

        if not description or not material_group or not material_type:
            leg_desc, leg_group, leg_type = await _get_legacy_fallback(client, material_number)
            description = description or leg_desc
            material_group = material_group or leg_group
            material_type = material_type or leg_type

        if not description:
            return None

        return {
            "MaterialNumber": material_number,
            "Description": description,
            "MaterialGroup": material_group,
            "MaterialType": material_type,
            "fromMara": mara is not None,
        }

async def get_legacy_material_details(material_number: str) -> tuple[str | None, str | None]:
    """Backward-compatible wrapper."""
    details = await get_material_details(material_number)
    if details is None:
        return None, None
    return details["Description"], details.get("MaterialGroup")

async def approve_classification(material_number: str, description: str, hsn: str) -> None:
    from datetime import datetime, timezone

    # Prefer MAKT description when MARA exists
    details = await get_material_details(material_number)
    if details and details.get("fromMara"):
        description = details["Description"]

    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        payload = {"MaterialNumber": material_number, "Description": description, "HSN": hsn}
        resp = await client.post("/ApprovedClassifications", json=payload)
        if resp.status_code not in (200, 201, 204):
            enc = quote(material_number, safe="")
            resp = await client.patch(f"/ApprovedClassifications(MaterialNumber='{enc}')", json=payload)
        resp.raise_for_status()

        filter_expr = quote(f"Material eq '{material_number}'", safe="")
        resp = await client.get(f"/ZMM_MAT_LEGACY?$filter={filter_expr}")
        resp.raise_for_status()
        legacy_rows = resp.json().get("value", [])

        for legacy_row in legacy_rows:
            legacy_row["HSN"] = hsn
            legacy_row["ApprovedAt"] = datetime.now(timezone.utc).isoformat()

            serial = legacy_row["Legacy_Serial_number"]
            post_resp = await client.post("/ZMM_MAT_APPROVED", json=legacy_row)
            if post_resp.status_code not in (200, 201, 204):
                serial_encoded = quote(serial, safe="")
                post_resp = await client.patch(f"/ZMM_MAT_APPROVED(Legacy_Serial_number='{serial_encoded}')", json=legacy_row)
            post_resp.raise_for_status()

            serial_encoded = quote(serial, safe="")
            patch_leg_resp = await client.patch(f"/ZMM_MAT_LEGACY(Legacy_Serial_number='{serial_encoded}')", json={"HSN": hsn})
            patch_leg_resp.raise_for_status()

async def get_candidate_suggestions(material_number: str | None = None) -> list[dict]:
    params = {"$orderby": "Rank asc"}
    if material_number:
        enc = quote(material_number, safe="")
        params["$filter"] = f"MaterialNumber eq '{enc}'"
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        resp = await client.get("/CandidateSuggestions", params=params)
    resp.raise_for_status()
    return resp.json().get("value", [])

async def save_candidate_suggestions(material_number: str, candidates: list[dict]) -> None:
    enc = quote(material_number, safe="")
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        for rank, cand in enumerate(candidates, start=1):
            payload = {
                "MaterialNumber": material_number,
                "Rank": rank,
                "CandidateCode": cand["Code"],
                "Score": float(cand["score"]),
            }
            resp = await client.post("/CandidateSuggestions", json=payload)
            if resp.status_code not in (200, 201, 204):
                resp = await client.patch(
                    f"/CandidateSuggestions(MaterialNumber='{enc}',Rank={rank})",
                    json=payload,
                )
            resp.raise_for_status()

async def get_pending_material_numbers() -> list[str]:
    """Legacy queue flags pending work; MARA confirms the material exists in master data."""
    legacy_rows = await get_all("ZMM_MAT_LEGACY", {
        "$filter": "HSN eq '9999'",
        "$select": "Legacy_Serial_number,Material,HSN",
    })
    mara_numbers = {row["MaterialNumber"] for row in await get_mara()}
    pending = list(dict.fromkeys(
        row["Material"] for row in legacy_rows
        if row.get("Material") and row["Material"] in mara_numbers
    ))
    skipped = len({row["Material"] for row in legacy_rows if row.get("Material")}) - len(pending)
    if skipped:
        print(f"Batch: skipped {skipped} legacy row(s) with no MARA master record.")
    print(f"Batch: found {len(pending)} materials to rank (HSN=9999, in MARA).")
    return pending

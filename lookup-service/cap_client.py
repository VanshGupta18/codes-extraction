import os
from urllib.parse import quote
import httpx

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "http://localhost:4004/odata/v4/hsn")

async def get_all(entity: str) -> list[dict]:
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        resp = await client.get(f"/{entity}", params={"$top": 20000})
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

async def get_legacy_materials():
    return await get_all("ZMM_MAT_LEGACY")

async def get_legacy_material_details(material_number: str) -> tuple[str | None, str | None]:
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        # Get row directly from Legacy Table
        resp = await client.get(f"/ZMM_MAT_LEGACY(Material='{material_number}')")
        if resp.status_code != 200:
            return None, None
            
        row = resp.json()
        desc = row.get("Material_Description")
        
        # Get MaterialGroup from MARA
        resp_mara = await client.get(f"/MARA(MaterialNumber='{material_number}')")
        mat_group = resp_mara.json().get("MaterialGroup") if resp_mara.status_code == 200 else None
        
        return desc, mat_group

async def approve_classification(material_number: str, description: str, hsn: str) -> None:
    from datetime import datetime, timezone
    
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        # 1. Post to ApprovedClassifications (learning corpus)
        resp = await client.post(
            "/ApprovedClassifications",
            json={"MaterialNumber": material_number, "Description": description, "HSN": hsn},
        )
        resp.raise_for_status()
        
        # 2. Fetch full raw record from Legacy queue
        resp = await client.get(f"/ZMM_MAT_LEGACY(Material='{material_number}')")
        resp.raise_for_status()
        legacy_row = resp.json()
        
        # 3. Post full raw record + HSN into Approved table
        legacy_row["HSN"] = hsn
        legacy_row["ApprovedAt"] = datetime.now(timezone.utc).isoformat()
        
        resp = await client.post(
            "/ZMM_MAT_APPROVED",
            json=legacy_row,
        )
        resp.raise_for_status()
        
        # Note: We are leaving the record in ZMM_MAT_LEGACY as requested.

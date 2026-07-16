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
        # Get row via filter since Material is no longer the primary key
        from urllib.parse import quote
        filter_expr = quote(f"Material eq '{material_number}'", safe="")
        resp = await client.get(f"/ZMM_MAT_LEGACY?$filter={filter_expr}&$top=1")
        if resp.status_code != 200 or not resp.json().get("value"):
            return None, None
            
        row = resp.json()["value"][0]
        desc = row.get("Material_Description")
        
        # Get MaterialGroup from MARA
        resp_mara = await client.get(f"/MARA(MaterialNumber='{material_number}')")
        mat_group = resp_mara.json().get("MaterialGroup") if resp_mara.status_code == 200 else None
        
        return desc, mat_group

async def approve_classification(material_number: str, description: str, hsn: str) -> None:
    from datetime import datetime, timezone
    
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        # 1. Post to ApprovedClassifications (learning corpus)
        payload = {"MaterialNumber": material_number, "Description": description, "HSN": hsn}
        resp = await client.post("/ApprovedClassifications", json=payload)
        if resp.status_code not in (200, 201, 204):
            resp = await client.patch(f"/ApprovedClassifications(MaterialNumber='{material_number}')", json=payload)
        resp.raise_for_status()
        
        # 2. Fetch all raw records for this material from Legacy queue
        from urllib.parse import quote
        filter_expr = quote(f"Material eq '{material_number}'", safe="")
        resp = await client.get(f"/ZMM_MAT_LEGACY?$filter={filter_expr}")
        resp.raise_for_status()
        legacy_rows = resp.json().get("value", [])
        
        # 3. Post full raw records + HSN into Approved table
        for legacy_row in legacy_rows:
            legacy_row["HSN"] = hsn
            legacy_row["ApprovedAt"] = datetime.now(timezone.utc).isoformat()
            
            serial = legacy_row["Legacy_Serial_number"]
            post_resp = await client.post("/ZMM_MAT_APPROVED", json=legacy_row)
            if post_resp.status_code not in (200, 201, 204):
                serial_encoded = quote(serial, safe="")
                post_resp = await client.patch(f"/ZMM_MAT_APPROVED(Legacy_Serial_number='{serial_encoded}')", json=legacy_row)
            post_resp.raise_for_status()
            
            # 4. Update the legacy table so HSN is no longer '9999'
            serial_encoded = quote(serial, safe="")
            patch_leg_resp = await client.patch(f"/ZMM_MAT_LEGACY(Legacy_Serial_number='{serial_encoded}')", json={"HSN": hsn})
            patch_leg_resp.raise_for_status()
        
        # Note: We are leaving the record in ZMM_MAT_LEGACY as requested, but updated its HSN.

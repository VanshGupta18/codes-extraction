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

async def get_material_details(material_number: str) -> tuple[str | None, str | None]:
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        # Get Description from MAKT
        filter_expr = quote(f"MaterialNumber eq '{material_number}' and Language eq 'EN'", safe="")
        resp = await client.get(f"/MAKT?$filter={filter_expr}&$top=1")
        resp.raise_for_status()
        rows = resp.json().get("value", [])
        desc = rows[0]["Description"] if rows else None
        
        # Get MaterialGroup from MARA
        resp_mara = await client.get(f"/MARA(MaterialNumber='{material_number}')")
        mat_group = resp_mara.json().get("MaterialGroup") if resp_mara.status_code == 200 else None
        
        return desc, mat_group

async def get_makt_description(material_number: str) -> str | None:
    desc, _ = await get_material_details(material_number)
    return desc

async def approve_classification(material_number: str, description: str, hsn: str) -> None:
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        resp = await client.post(
            "/ApprovedClassifications",
            json={"MaterialNumber": material_number, "Description": description, "HSN": hsn},
        )
        resp.raise_for_status()
        resp = await client.patch(
            f"/ZMM_MAT_LEGACY(MaterialNumber='{material_number}')",
            json={"HSN": hsn},
        )
        resp.raise_for_status()

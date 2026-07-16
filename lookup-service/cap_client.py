import os
from urllib.parse import quote
import httpx

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "http://localhost:4004/odata/v4/hsn")


async def get_makt_description(material_number: str) -> str | None:
    filter_expr = quote(f"MaterialNumber eq '{material_number}' and Language eq 'EN'", safe="")
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        resp = await client.get(f"/MAKT?$filter={filter_expr}&$top=1")
    resp.raise_for_status()
    rows = resp.json().get("value", [])
    return rows[0]["Description"] if rows else None


async def get_all(entity: str) -> list[dict]:
    async with httpx.AsyncClient(base_url=CAP_BASE_URL) as client:
        resp = await client.get(f"/{entity}", params={"$top": 20000})
    resp.raise_for_status()
    return resp.json().get("value", [])


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

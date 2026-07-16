import hashlib
import json
import os
from urllib.parse import quote, urlencode, urljoin

import httpx

from auth import get_auth_headers

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "http://localhost:4004/odata/v4/hsn")


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    headers = kwargs.pop("headers", {})
    auth = await get_auth_headers()
    headers = {"Content-Type": "application/json", **auth, **headers}
    async with httpx.AsyncClient(base_url=CAP_BASE_URL, timeout=120) as client:
        resp = await client.request(method, path, headers=headers, **kwargs)
    return resp


async def _post_action(action: str, payload: dict) -> httpx.Response:
    return await _request("POST", f"/{action}", json=payload)


async def get_all(entity: str, params: dict | None = None, *, top: int | None = 20000) -> list[dict]:
    query = dict(params or {})
    if top is not None and "$top" not in query:
        query["$top"] = top

    encoded = urlencode(query, quote_via=quote, safe="$(),'=")
    next_url = f"{CAP_BASE_URL.rstrip('/')}/{entity}"
    if encoded:
        next_url = f"{next_url}?{encoded}"

    rows: list[dict] = []
    auth = await get_auth_headers()
    async with httpx.AsyncClient(timeout=120) as client:
        while next_url:
            resp = await client.get(next_url, headers=auth)
            if not resp.is_success:
                print(f"CAP GET /{entity} failed ({resp.status_code}): {resp.text[:300]}")
            resp.raise_for_status()
            payload = resp.json()
            rows.extend(payload.get("value", []))
            if top is not None and len(rows) >= top:
                return rows[:top]
            next_link = payload.get("@odata.nextLink")
            next_url = (
                urljoin(f"{CAP_BASE_URL.rstrip('/')}/", next_link)
                if next_link
                else None
            )
    return rows


async def call_action(action: str, payload: dict | None = None):
    resp = await _post_action(action, payload or {})
    if not resp.is_success:
        print(f"CAP action {action} failed ({resp.status_code}): {resp.text[:300]}")
    resp.raise_for_status()
    body = resp.json() if resp.content else {}
    return body.get("value", body)


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
    auth = await get_auth_headers()
    async with httpx.AsyncClient(base_url=CAP_BASE_URL, headers=auth) as client:
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
    details = await get_material_details(material_number)
    if details is None:
        return None, None
    return details["Description"], details.get("MaterialGroup")


async def approve_classification(material_number: str, description: str, hsn: str) -> None:
    from datetime import datetime, timezone

    details = await get_material_details(material_number)
    if details and details.get("fromMara"):
        description = details["Description"]

    auth = await get_auth_headers()
    async with httpx.AsyncClient(base_url=CAP_BASE_URL, headers=auth) as client:
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
                post_resp = await client.patch(
                    f"/ZMM_MAT_APPROVED(Legacy_Serial_number='{serial_encoded}')",
                    json=legacy_row,
                )
            post_resp.raise_for_status()

            serial_encoded = quote(serial, safe="")
            patch_leg_resp = await client.patch(
                f"/ZMM_MAT_LEGACY(Legacy_Serial_number='{serial_encoded}')",
                json={"HSN": hsn},
            )
            patch_leg_resp.raise_for_status()


async def get_candidate_suggestions(material_number: str | None = None) -> list[dict]:
    params = {"$orderby": "Rank asc"}
    if material_number:
        params["$filter"] = f"MaterialNumber eq '{material_number}'"
    return await get_all("CandidateSuggestions", params, top=None)


async def save_candidate_suggestions(material_number: str, candidates: list[dict]) -> None:
    entries = [
        {
            "Rank": rank,
            "CandidateCode": candidate["Code"],
            "Score": float(candidate.get("confidence", candidate.get("score", 0))),
        }
        for rank, candidate in enumerate(candidates, start=1)
    ]
    await call_action("replaceCandidateSuggestions", {
        "materialNumber": material_number,
        "candidatesJson": json.dumps(entries),
    })


async def get_pending_material_numbers() -> list[str]:
    mara_numbers = {row["MaterialNumber"] for row in await get_mara()}

    try:
        legacy_rows = await get_all("ZMM_MAT_LEGACY", {
            "$filter": "HSN eq '9999'",
            "$select": "Legacy_Serial_number,Material",
        }, top=None)
    except httpx.HTTPStatusError:
        legacy_rows = [
            r for r in await get_all("ZMM_MAT_LEGACY", top=5000)
            if r.get("HSN") == "9999"
        ]

    pending = list(dict.fromkeys(
        row["Material"] for row in legacy_rows
        if row.get("Material") and row["Material"] in mara_numbers
    ))
    skipped = len({row["Material"] for row in legacy_rows if row.get("Material")}) - len(pending)
    if skipped:
        print(f"Batch: skipped {skipped} legacy row(s) with no MARA master record.")
    print(f"Batch: found {len(pending)} materials to rank (HSN=9999, in MARA).")
    return pending


def description_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


async def fetch_corpus_similarity(
    embedding: list[float],
    sources: list[str],
    codes: list[str],
) -> list[dict]:
    raw = await call_action("fetchCorpusSimilarity", {
        "embeddingJson": json.dumps(embedding),
        "sourcesJson": json.dumps(sources),
        "codesJson": json.dumps(codes),
    })
    if isinstance(raw, str):
        return json.loads(raw or "[]")
    return raw if isinstance(raw, list) else []


async def upsert_tariff_embeddings(batch: list[dict]) -> int:
    result = await call_action("upsertTariffEmbeddings", {
        "batchJson": json.dumps(batch),
    })
    return int(result or 0)


async def count_tariff_embeddings() -> int:
    result = await call_action("countTariffEmbeddings", {})
    return int(result or 0)


async def set_system_metadata(key: str, value: str) -> None:
    await call_action("setSystemMetadata", {"id": key, "value": value})


async def get_system_metadata(key: str) -> str:
    result = await call_action("getSystemMetadata", {"id": key})
    return str(result or "")

"""Shared ranking, index build, and batch logic for API + CF worker."""
import asyncio
from datetime import datetime, timezone

import cap_client
import embedding_client
import govt_lookup
from govt_lookup import Index, sources_for_tariff

_index: Index | None = None
_index_error: str | None = None
_index_lock = asyncio.Lock()

_SERVICE_TYPES = {"DIEN", "SERV", "ZSER"}


def tariff_for(material_type: str) -> str:
    return "SAC" if (material_type or "").upper() in _SERVICE_TYPES else "HSN"


def normalize_tariff_code(code: str, material_type: str = "") -> str:
    """Pad numeric codes to govt master width (HSN 8 / SAC 6)."""
    cleaned = (code or "").strip()
    if not cleaned.isdigit():
        return cleaned
    width = 6 if tariff_for(material_type) == "SAC" else 8
    return cleaned.zfill(width)


def normalize_rows(raw: list[dict], code_key: str = "Code", source: str = "GOVT") -> list[dict]:
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


async def build_index() -> None:
    global _index, _index_error
    print("Loading BM25 search index from CAP...")

    for attempt in range(1, 31):
        try:
            approved_raw = await cap_client.get_approved_classifications()
            approved = normalize_rows(
                [a for a in approved_raw if a.get("HSN")],
                code_key="HSN",
                source="APPROVED",
            )
            hsn_rows = normalize_rows(await cap_client.get_govt_hsn(), source="GOVT_HSN")
            sac_rows = normalize_rows(await cap_client.get_govt_sac(), source="GOVT_SAC")
            mara = await cap_client.get_mara()

            approved_by_mat = {
                a["MaterialNumber"]: a["Code"]
                for a in approved
                if "MaterialNumber" in a
            }
            affinity = {}
            for mat in mara:
                mat_num = mat.get("MaterialNumber")
                mat_group = mat.get("MaterialGroup")
                if mat_group and mat_num in approved_by_mat:
                    affinity[mat_group] = approved_by_mat[mat_num][:4]

            all_rows = approved + hsn_rows + sac_rows
            print(
                f"BM25 index ready: {len(all_rows)} rows "
                f"({len(approved)} approved, {len(hsn_rows)} HSN, {len(sac_rows)} SAC)."
            )

            async with _index_lock:
                _index = Index(fallback_rows=all_rows, fallback_affinity=affinity)
                _index_error = None
            return
        except Exception as exc:
            _index_error = str(exc)
            print(f"Index build attempt {attempt}/30 failed: {exc}")
            await asyncio.sleep(10)

    print("Search index failed to build after 30 attempts.")


def get_index() -> Index | None:
    return _index


def get_index_error() -> str | None:
    return _index_error


async def _cosine_scores_for_shortlist(
    index: Index,
    description: str,
    query_embedding,
    tariff: str,
) -> dict:
    codes, sources, _ = index.shortlist_codes_and_sources(description, tariff=tariff)
    if not codes:
        return {}

    embedding_list = embedding_client.embedding_to_list(query_embedding)
    if not embedding_list:
        return {}

    rows = await cap_client.fetch_corpus_similarity(embedding_list, sources, codes)
    scores = {}
    for row in rows:
        key = (row.get("source"), row.get("code"))
        scores[key] = float(row.get("cosineScore", 0.0))
    return scores


async def rank_material(material_number: str) -> dict:
    index = _index
    if not index:
        raise RuntimeError(_index_error or "Index not ready")

    details = await cap_client.get_material_details(material_number)
    if details is None:
        raise LookupError(
            f"No material master (MARA/MAKT) or legacy description for '{material_number}'"
        )

    description = details["Description"]
    material_group = details.get("MaterialGroup")
    material_type = details.get("MaterialType") or ""
    tariff = tariff_for(material_type)

    query_embedding = await embedding_client.get_embedding(description)
    cosine_scores = await _cosine_scores_for_shortlist(index, description, query_embedding, tariff)

    candidates = index.rank(
        description,
        query_embedding=query_embedding,
        cosine_scores=cosine_scores,
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


async def rank_and_save(material_number: str) -> dict:
    result = await rank_material(material_number)
    await cap_client.save_candidate_suggestions(material_number, result["candidates"])
    return result


async def upsert_approved_embedding(code: str, description: str) -> None:
    embedding = await embedding_client.get_embedding(description)
    embedding_list = embedding_client.embedding_to_list(embedding)
    if not embedding_list:
        return
    await cap_client.upsert_tariff_embeddings([{
        "code": code,
        "source": "APPROVED",
        "description": description,
        "descriptionHash": cap_client.description_hash(description),
        "model": embedding_client.EMBEDDING_MODEL_NAME,
        "embedding": embedding_list,
    }])


async def run_batch_job() -> None:
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
            result = await rank_and_save(mat_num)
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
    await cap_client.set_system_metadata(
        "last_batch_run",
        datetime.now(timezone.utc).isoformat(),
    )

"""Precompute FastEmbed vectors for govt + approved corpus into HANA."""
import asyncio
from datetime import datetime, timezone

import cap_client
import embedding_client
from ranking_core import normalize_rows


BATCH_UPSERT_SIZE = 100


async def _corpus_rows() -> list[dict]:
    approved_raw = await cap_client.get_approved_classifications()
    approved = normalize_rows(
        [a for a in approved_raw if a.get("HSN")],
        code_key="HSN",
        source="APPROVED",
    )
    hsn_rows = normalize_rows(await cap_client.get_govt_hsn(), source="GOVT_HSN")
    sac_rows = normalize_rows(await cap_client.get_govt_sac(), source="GOVT_SAC")
    return approved + hsn_rows + sac_rows


async def build_embedding_index() -> None:
    rows = await _corpus_rows()
    print(f"Embedding index: {len(rows)} corpus rows from CAP")

    descriptions = [row["Description"] for row in rows]
    vectors = await embedding_client.get_embeddings(descriptions)

    batch: list[dict] = []
    upserted = 0

    for row, vector in zip(rows, vectors):
        embedding_list = embedding_client.embedding_to_list(vector)
        if not embedding_list:
            continue
        batch.append({
            "code": row["Code"],
            "source": row["Source"],
            "description": row["Description"],
            "descriptionHash": cap_client.description_hash(row["Description"]),
            "model": embedding_client.EMBEDDING_MODEL_NAME,
            "embedding": embedding_list,
        })
        if len(batch) >= BATCH_UPSERT_SIZE:
            upserted += await cap_client.upsert_tariff_embeddings(batch)
            print(f"  upserted {upserted} embeddings...")
            batch = []

    if batch:
        upserted += await cap_client.upsert_tariff_embeddings(batch)

    count = await cap_client.count_tariff_embeddings()
    ts = datetime.now(timezone.utc).isoformat()
    await cap_client.set_system_metadata("embedding_index_built_at", ts)
    await cap_client.set_system_metadata("embedding_index_count", str(count))
    print(f"Embedding index complete: {upserted} upserted, {count} rows in HANA.")


def main() -> None:
    asyncio.run(build_embedding_index())


if __name__ == "__main__":
    main()

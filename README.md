# HSN Classification Service

Automates HSN/SAC (GST tariff) code classification for SAP material master data. Materials with dummy HSN `9999` are ranked against the government tariff master; humans approve; approvals feed a self-learning corpus.

## Architecture

```
Browser → AppRouter (XSUAA)
       → CAP (OData + HANA + UI)  ←→  Lookup API (BM25 + query embed)
       → HANA Vector Engine (TariffCorpusEmbedding, 384-dim)
       → CF Worker (embedding index build + batch)
```

- **`cap/`** — SAP CAP on HANA Cloud: master data, queue, candidates, vector storage (not OData-exposed)
- **`lookup-service/`** — FastAPI ranking API + CF worker jobs
- **`cap/app/hsn-review-workbench/`** — React review UI

Ranking: **BM25 shortlist** (in-memory) + **HANA cosine similarity** (precomputed corpus embeddings) + approved-corpus boost.

## Quick start (BAS)

Operational runbook: local copy at `docs/BTP-BAS-RUNBOOK.md` (not committed — `docs/` is gitignored).

```bash
# 1. CAP + HANA
cd cap && npm install && cds bind && cds deploy --to hana && cds watch

# 2. Embedding index (once)
cd lookup-service && uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
export CAP_BASE_URL=http://localhost:4004/odata/v4/hsn
python -m jobs.build_embedding_index

# 3. Lookup API
uvicorn main:app --port 8000

# 4. UI (dev)
cd cap/app/hsn-review-workbench && npm run dev
```

## Production (CF)

```bash
mbt build && cf deploy mta_archives/hsn-codes-extraction_*.mtar
cf run-task hsn-lookup-worker --command "python -m jobs.build_embedding_index"
cf run-task hsn-lookup-worker --command "python -m jobs.run_batch"
```

## Tests

```bash
cd lookup-service && source .venv/bin/activate && python test_lookup.py
```

## Key paths

| Path | Role |
|------|------|
| `cap/db/schema.cds` | Entities incl. `TariffCorpusEmbedding` Vector(384) |
| `cap/srv/vector-handlers.js` | HANA cosine + bulk upsert actions |
| `lookup-service/ranking_core.py` | BM25 + HANA fusion |
| `lookup-service/jobs/` | Worker: index build + batch |
| `mta.yaml` | CF modules (API 512M, worker 1536M) |

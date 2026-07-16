# BTP / BAS Runbook — HSN Classification Service

Operations guide for SAP Business Application Studio (dev) and SAP BTP Cloud Foundry (production).

## Architecture

```
Browser → hsn-approuter (XSUAA)
       → /odata/*  → hsn-cap-srv (CAP + HANA)
       → /api/*    → hsn-lookup-service (FastAPI)
       → /*        → hsn-cap-srv (React UI static)

hsn-lookup-worker (no route) — CF tasks only:
  python -m jobs.build_embedding_index
  python -m jobs.run_batch
```

Corpus embeddings live in HANA `TariffCorpusEmbedding` (REAL_VECTOR 384). The API embeds **query text only**; batch and index build run on the worker.

---

## A. One-time BTP subaccount setup

1. **SAP HANA Cloud**
   - BTP Cockpit → SAP HANA Cloud → Create instance
   - Enable **Vector Engine** (QRC 1/2024+)

2. **Cloud Foundry**
   - Enable CF in subaccount; note org and space

3. **Service instances** (created by MTA deploy if absent)

   | Service | Plan | Purpose |
   |---------|------|---------|
   | SAP HANA Cloud | hdi-shared | HDI container |
   | XSUAA | application | Auth (users + service-to-service) |

4. **Role collections** (BTP Cockpit → Security → Role Collections)

   | Collection | Scopes |
   |------------|--------|
   | HSN-Classifier | `hsn-app.Classifier` |
   | HSN-Approver | `Classifier` + `Approver` |
   | HSN-Admin | all scopes |

5. **CF CLI** (optional from BAS terminal)
   ```bash
   cf login -a <api-endpoint> -o <org> -s <space>
   ```

---

## B. BAS development setup

### 1. Open project

- Dev space: **SAP CAP** (Node + Python + HANA)
- Clone/open `codes-extraction`

### 2. Bind HANA and deploy schema

```bash
cd cap
npm install
cds bind --to hsn-hana-db
cds deploy --to hana
```

Creates `default-env.json` (gitignored) with `VCAP_SERVICES`.

### 3. Python environment

```bash
cd lookup-service
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt
export CAP_BASE_URL=http://localhost:4004/odata/v4/hsn
```

### 4. Build embedding index (required after deploy or govt CSV refresh)

```bash
cd lookup-service
source .venv/bin/activate
export CAP_BASE_URL=http://localhost:4004/odata/v4/hsn
python -m jobs.build_embedding_index
```

First run downloads FastEmbed model (~5–15 min). Verify:

```bash
curl -X POST http://localhost:4004/odata/v4/hsn/countTariffEmbeddings
```

### 5. Daily dev — three terminals

**Terminal 1 — CAP**
```bash
cd cap && cds watch
```

**Terminal 2 — Lookup API**
```bash
cd lookup-service && source .venv/bin/activate
export CAP_BASE_URL=http://localhost:4004/odata/v4/hsn
uvicorn main:app --host 0.0.0.0 --port 8000
```

**Terminal 3 — React UI**
```bash
cd cap/app/hsn-review-workbench
npm install && npm run dev
```

Open BAS Preview on port **5173** (`/add`, `/review`, `/view`).

### 6. Smoke test

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/rank/<material-with-MARA>
python -m jobs.run_batch
```

### 7. Optional `cap/default-env.json`

```json
{
  "VCAP_SERVICES": {},
  "LOOKUP_SERVICE_URL": "http://localhost:8000"
}
```

---

## C. Production deploy (CF)

### 1. Build and deploy MTA

```bash
npm install -g mbt
mbt build
cf deploy mta_archives/hsn-codes-extraction_*.mtar
```

Modules: `hsn-cap-srv`, `hsn-db-deployer`, `hsn-lookup-service`, `hsn-lookup-worker`, `hsn-approuter`.

### 2. Post-deploy — embedding index (required)

```bash
cf run-task hsn-lookup-worker \
  --command "python -m jobs.build_embedding_index" \
  --name embed-index-initial
cf logs hsn-lookup-worker --recent
```

### 3. Run batch classification

```bash
cf run-task hsn-lookup-worker \
  --command "python -m jobs.run_batch" \
  --name batch-classify
cf logs hsn-lookup-worker --recent
```

### 4. User access

```bash
cf app hsn-approuter
```

Open approuter URL → XSUAA login → workbench.

---

## D. Operational tasks

| Task | When | Command |
|------|------|---------|
| Refresh govt tariff | New `HSN_SAC.xlsx` | `python3 scripts/convert_hsn_xlsx.py` → `cds deploy --to hana` → rebuild embedding index |
| Rebuild embeddings | After deploy / CSV refresh | BAS: `python -m jobs.build_embedding_index` / CF: `cf run-task hsn-lookup-worker --command "python -m jobs.build_embedding_index"` |
| Run batch | New pending materials | BAS: `python -m jobs.run_batch` / CF: `cf run-task ... run_batch` |
| Health check | After incident | `curl https://<approuter>/api/health` |
| Logs | Debugging | `cf logs hsn-lookup-service --recent` |

After **approve**, one APPROVED row is upserted to HANA automatically — full index rebuild not required.

---

## E. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/api/*` 502 | Lookup not running | Start lookup; restart CAP from `cap/` |
| 503 Index not ready | CAP unreachable at startup | Check CAP; retry after `cds watch` |
| 0% confidence | Empty vector index | Run `build_embedding_index` |
| OOM on CF | Batch on API dyno | Use `hsn-lookup-worker` CF task only |
| 401 lookup→CAP | Missing JWT | Verify xsuaa binding on lookup + worker |
| UI blank in prod | UI not built | Confirm MTA `build:ui` step; check CAP serves `dist/` |
| Not in Review queue | No MARA row | Legacy queue only; material needs MARA match |
| Vector SQL error | Vector engine off | Enable on HANA Cloud instance |
| BuildpackCompileFailed (lookup) | Wrong `runtime.txt` or pip OOM/disk | Use `python-3.11.x`; 2G disk; `cf logs hsn-lookup-service --recent` during staging |

---

## F. BAS ports

| Port | Service |
|------|---------|
| 5173 | Vite UI (dev) |
| 4004 | CAP OData |
| 8000 | Lookup API |

---

## G. Go-live checklist

- [ ] HANA Cloud vector engine enabled
- [ ] `cds deploy` succeeded; govt master count > 0
- [ ] `build_embedding_index` completed; `countTariffEmbeddings` > 0
- [ ] `run_batch` completed; `CandidateSuggestions` populated
- [ ] Approuter login works; role collections assigned
- [ ] Approve flow updates legacy + approved tables
- [ ] API 512M / worker 1536M; no OOM restarts

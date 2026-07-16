# HSN Classification Service (Maruti Suzuki)

Automates HSN/SAC (GST tariff) code classification for SAP material master data. Materials arrive in SAP with a dummy HSN (`9999`); this service suggests the top-3 most likely real HSN/SAC codes for a human to approve, and gets smarter over time as approvals accumulate.

## Why this exists

Today, HSN codes are assigned manually by reading each part's description — slow, inconsistent, and a GST/compliance risk while a part sits with a dummy code. See the original process write-up in this conversation's history for the full AS-IS/TO-BE narrative; this repo is the TO-BE implementation, scoped down to a runnable prototype.

## Architecture

Two independent services, split by responsibility:

```
┌─────────────┐  OData (HTTP)   ┌──────────────────┐
│  cap/       │ ◄────────────── │  lookup-service/  │
│  (Node.js,  │                 │  (Python,          │
│   SAP CAP)  │ ──────────────► │   FastAPI)         │
└─────────────┘                 └──────────────────┘
SAP connectivity                Matching + self-learning
only — no business logic        logic lives entirely here
```

- **`cap/`** — a CAP (Cloud Application Programming) project. Its only job is exposing SAP-shaped tables as OData: `MARA`, `MAKT`, `MARC` (material master data), the official government `GovtHSNMaster`/`GovtSACMaster` reference tables, the pending-classification queue `ZMM_MAT_LEGACY`, and the self-learning `ApprovedClassifications` table. Runs on in-memory SQLite for now (`@cap-js/sqlite`) — swapping to a real S/4HANA/HANA Cloud connection later is a `cds.requires` config change on this side only.
- **`lookup-service/`** — a FastAPI app that owns all matching logic. It never touches a database directly; everything goes through CAP's OData API (`cap_client.py`).

## How matching works

1. `GET /candidates/{materialNumber}` pulls the material's description from `MAKT`, then ranks candidate HSN/SAC codes using **BM25 keyword search** (`rank_bm25`) over a corpus made of:
   - `ApprovedClassifications` — every previously human-approved match (highest trust, exact company vocabulary).
   - `GovtHSNMaster` / `GovtSACMaster` — the official government tariff directory (`HSN_SAC.xlsx`), pre-processed by `scripts/convert_hsn_xlsx.py` to enrich each leaf code with its parent chapter/heading text (many leaf codes are just labeled "OTHER" — the real meaning lives one level up the hierarchy).
   - A static abbreviation dictionary (`abbreviations.py`) expands common SAP/automotive shorthand (`RR`→`REAR`, `BRKT`→`BRACKET`, etc.) before matching, since government tariff text never uses engineering abbreviations.
2. The endpoint always returns the **top 3 candidates** with scores — no auto-posting. A human picks one.
3. `POST /approve` writes the chosen code back to `ZMM_MAT_LEGACY` **and** appends a new row to `ApprovedClassifications`, then rebuilds the in-memory BM25 index. This is the self-learning loop: the next near-identical description matches this exact prior approval instead of the generic government text.

**Why BM25 instead of AI/vector search:** validated empirically against the real government data (see conversation history) — a lightweight, deterministic, fully-auditable keyword search plus a growing approved-examples corpus was sufficient. Vector/embedding search and LLM (AI Core) adjudication are intentionally deferred; see `Deferred` below for exactly when to add them.

## Project layout

```
HSN_SAC.xlsx                    official govt HSN+SAC tariff directory (source data)
scripts/
  convert_hsn_xlsx.py            xlsx -> CAP seed CSVs, with ancestor-text enrichment
cap/                             SAP connectivity layer (CAP, Node.js)
  db/schema.cds                  entity definitions
  db/data/*.csv                  seed data (govt tables generated; others hand-authored)
  srv/hsn-service.cds            OData service exposing the entities
lookup-service/                  matching + self-learning layer (Python, FastAPI)
  abbreviations.py                engineering-shorthand expansion dictionary
  govt_lookup.py                  BM25 index + scoring
  cap_client.py                   OData HTTP client (talks to cap/, nothing else)
  main.py                         FastAPI app: GET /candidates, POST /approve
  test_lookup.py                  end-to-end verification script
```

## Running it

```bash
# 1. Generate the government reference tables from the source xlsx (run once, or whenever HSN_SAC.xlsx is refreshed)
python3 scripts/convert_hsn_xlsx.py

# 2. Start the SAP connectivity layer
cd cap && npm install && npm start        # OData on http://localhost:4004

# 3. Start the matching service (separate terminal)
cd lookup-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000              # FastAPI on http://localhost:8000

# 4. Verify end-to-end
python3 lookup-service/test_lookup.py
```

Try it manually:
```bash
curl http://localhost:8000/candidates/MAT-3001
curl -X POST http://localhost:8000/approve \
  -H "Content-Type: application/json" \
  -d '{"materialNumber": "MAT-3002", "chosenCode": "87081090"}'
```

## Current status

The core pipeline above is built and verified against small hand-authored seed data (`MAT-3001`..`MAT-3003`). **In progress:** wiring in the real Maruti exports (`MARA ...xlsx`, `MARC ...xlsx`, `MAT LEGACY TABLE CUSTOM ...xlsx` in the project root) to replace the placeholder seed data with real material master records, so the pending-classification queue (`ZMM_MAT_LEGACY`) reflects genuine materials instead of demo rows.

## Deferred (clean extension points, not built yet)

- **Vector/embedding hybrid search** — add as a second ranking signal alongside BM25 if top-1 suggestion approval rate plateaus low once the approved corpus has real volume.
- **AI Core / LLM adjudication** — a narrow future role judging between an already-ranked top-3 when scores are near-tied; never a full-corpus search mechanism.
- **Material-Group affinity boost** — `MARA.MaterialGroup` is captured but unused; once enough approvals exist, compute a group→HSN-chapter affinity bonus from approval history.
- **Real SAP S/4HANA / HANA Cloud connectivity** — swap `@cap-js/sqlite` for a `cds.requires` destination binding on the CAP side only.
- **Scheduled BTP job** — loop over `PENDING` `ZMM_MAT_LEGACY` records calling `GET /candidates`.
- **Fiori/React review UI** — consumes `GET /candidates` + `POST /approve` directly.
- **Auth/security (xsuaa, roles) and audit logging.**

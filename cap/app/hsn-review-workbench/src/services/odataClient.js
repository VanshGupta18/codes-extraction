/**
 * OData Client — HSN Review Workbench
 *
 * Reads/writes via CAP OData (/odata/v4/hsn). Batch, rank, and approve go through
 * CAP actions (server-side forward to lookup-service) — no /api browser proxy needed.
 */

const ODATA = '/odata/v4/hsn';

async function fetchCsrfToken() {
  const res = await fetch(`${ODATA}/`, {
    credentials: 'include',
    headers: { 'X-CSRF-Token': 'Fetch' },
  });
  return res.headers.get('X-CSRF-Token') || '';
}

async function odataPost(action, payload) {
  const csrf = await fetchCsrfToken();
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${ODATA}/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OData ${action} failed (${res.status}): ${detail || res.statusText}`);
  }

  const json = await res.json();
  return json.value ?? json;
}

// ── Read ───────────────────────────────────────────────────────────────────

export async function fetchMaterialQueue() {
  const [resLegacy, resMara, resMakt, resCands] = await Promise.all([
    fetch(`${ODATA}/ZMM_MAT_LEGACY?$filter=HSN eq '9999'&$select=Material,ZZ1_MM_RP_PLT,Legacy_Serial_number`),
    fetch(`${ODATA}/MARA?$select=MaterialNumber,MaterialGroup,MaterialType`),
    fetch(`${ODATA}/MAKT?$filter=Language eq 'EN'&$select=MaterialNumber,Description`),
    fetch(`${ODATA}/CandidateSuggestions?$orderby=Rank asc`),
  ]);
  if (!resLegacy.ok) throw new Error('Failed to fetch legacy materials');
  if (!resMara.ok) throw new Error('Failed to fetch MARA master data');
  if (!resMakt.ok) throw new Error('Failed to fetch MAKT descriptions');
  if (!resCands.ok) throw new Error('Failed to fetch candidate suggestions');

  const jsonLegacy = await resLegacy.json();
  const maraById = new Map((await resMara.json()).value.map((r) => [r.MaterialNumber, r]));
  const maktById = new Map((await resMakt.json()).value.map((r) => [r.MaterialNumber, r.Description]));
  const jsonCands = await resCands.json();

  const uniqueMaterials = new Map();
  for (const row of jsonLegacy.value) {
    if (!row.Material || uniqueMaterials.has(row.Material)) continue;
    const mara = maraById.get(row.Material);
    if (!mara) continue;

    uniqueMaterials.set(row.Material, {
      materialId: row.Material,
      materialType: mara.MaterialType,
      description: maktById.get(row.Material) ?? '',
      category: mara.MaterialGroup,
      group: mara.MaterialGroup,
      plant: row.ZZ1_MM_RP_PLT || 'N/A',
      hsnCandidates: [],
      status: 'Pending',
      reviewedBy: null,
      lastModified: new Date().toISOString(),
    });
  }

  for (const cand of jsonCands.value) {
    if (uniqueMaterials.has(cand.MaterialNumber)) {
      const mat = uniqueMaterials.get(cand.MaterialNumber);
      mat.hsnCandidates.push({
        hsn: cand.CandidateCode,
        confidence: cand.Score,
        source: cand.Rank === 1 ? 'BM25 Top Match' : 'BM25 Alternative',
      });
      mat.status = 'AI-Assist';
    }
  }

  return Array.from(uniqueMaterials.values());
}

// ── Write ──────────────────────────────────────────────────────────────────

export async function approveHsn(materialId, hsn) {
  await odataPost('approveMaterial', { materialNumber: materialId, chosenCode: hsn });
  return { success: true };
}

export async function submitManualHsn(materialId, hsn, reason) {
  return approveHsn(materialId, hsn);
}

export async function bulkApprove(materialIds) {
  for (const matId of materialIds) {
    const res = await fetch(`${ODATA}/CandidateSuggestions?$filter=MaterialNumber eq '${matId}' and Rank eq 1`);
    const json = await res.json();
    if (json.value?.length > 0) {
      await approveHsn(matId, json.value[0].CandidateCode);
    }
  }
  return { success: true, count: materialIds.length };
}

export async function addLegacyMaterial(materialData) {
  const csrf = await fetchCsrfToken();
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const response = await fetch(`${ODATA}/ZMM_MAT_LEGACY`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(materialData),
  });
  if (!response.ok) {
    throw new Error(`OData error: ${await response.text()}`);
  }
  return response.json();
}

export async function fetchAllMasterData() {
  const response = await fetch(`${ODATA}/ZMM_MAT_LEGACY?$top=5000`);
  if (!response.ok) throw new Error('Failed to fetch master data');
  const data = await response.json();

  const uniqueMaterials = new Map();
  for (const row of data.value) {
    if (!row.Material) continue;
    if (!uniqueMaterials.has(row.Material)) {
      uniqueMaterials.set(row.Material, row);
    } else {
      const existing = uniqueMaterials.get(row.Material);
      if (existing.HSN === '9999' && row.HSN !== '9999') {
        uniqueMaterials.set(row.Material, row);
      }
    }
  }
  return Array.from(uniqueMaterials.values());
}

export async function fetchMaterialDetails(materialId) {
  const enc = encodeURIComponent(materialId);
  const [resLeg, resApp] = await Promise.all([
    fetch(`${ODATA}/ZMM_MAT_LEGACY?$filter=Material eq '${enc}'`),
    fetch(`${ODATA}/ZMM_MAT_APPROVED?$filter=Material eq '${enc}'`),
  ]);
  return {
    legacy: resLeg.ok ? (await resLeg.json()).value : [],
    approved: resApp.ok ? (await resApp.json()).value : [],
  };
}

export async function triggerBatchPipeline() {
  const message = await odataPost('triggerBatch', {});
  return { message };
}

export async function rankMaterial(materialId) {
  await odataPost('rankMaterial', { materialNumber: materialId });
  return { success: true };
}

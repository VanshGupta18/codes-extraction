/**
 * OData Client — HSN Review Workbench
 *
 * Reads via CAP OData (/odata/v4/hsn).
 * Batch / rank / approve via /api/* → lookup-service (Vite proxy, cap/server.js, or approuter).
 */

const ODATA = '/odata/v4/hsn';
const LOOKUP_API = import.meta.env.VITE_LOOKUP_API_URL || '/api';

async function lookupPost(path, body) {
  const csrf = await fetchCsrfToken();
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${LOOKUP_API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    let message = detail || res.statusText;
    try {
      const json = JSON.parse(detail);
      if (typeof json.detail === 'string') message = json.detail;
    } catch {
      // keep raw body
    }
    throw new Error(
      `Lookup POST ${path} failed (${res.status}): ${message}. ` +
      'Ensure lookup-service is on port 8000 and CAP was restarted (cap/server.js proxy).',
    );
  }
  return res.json();
}

async function fetchODataAll(entity, params = {}) {
  const qs = new URLSearchParams({ $top: '5000', ...params });
  let url = `${ODATA}/${entity}?${qs}`;
  const rows = [];

  while (url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch ${entity}`);
    const data = await res.json();
    rows.push(...(data.value || []));
    const next = data['@odata.nextLink'];
    if (!next) break;
    url = next.startsWith('http') ? next : (next.startsWith('/') ? next : `${ODATA}/${next}`);
  }
  return rows;
}

async function fetchCsrfToken() {
  const res = await fetch(`${ODATA}/`, {
    credentials: 'include',
    headers: { 'X-CSRF-Token': 'Fetch' },
  });
  return res.headers.get('X-CSRF-Token') || '';
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
  await lookupPost('/approve', { materialNumber: materialId, chosenCode: (hsn || '').trim() });
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

export async function isPendingLegacyMaterial(materialNumber) {
  const enc = encodeURIComponent(materialNumber.trim());
  const res = await fetch(
    `${ODATA}/ZMM_MAT_LEGACY?$filter=Material eq '${enc}' and HSN eq '9999'&$select=Material&$top=1`,
  );
  if (!res.ok) return false;
  const json = await res.json();
  return (json.value?.length ?? 0) > 0;
}

function parseODataError(body) {
  try {
    const json = JSON.parse(body);
    return json.error?.message || json.error?.details?.[0]?.message || body;
  } catch {
    return body;
  }
}

export async function addLegacyMaterial(materialData) {
  const payload = Object.fromEntries(
    Object.entries(materialData).filter(([, value]) => String(value ?? '').trim() !== ''),
  );

  const csrf = await fetchCsrfToken();
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const response = await fetch(`${ODATA}/ZMM_MAT_LEGACY`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(parseODataError(await response.text()));
  }
  return response.json();
}

export async function fetchAllMasterData() {
  const rows = await fetchODataAll('ZMM_MAT_LEGACY');

  const uniqueMaterials = new Map();
  for (const row of rows) {
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
  return lookupPost('/trigger_batch');
}

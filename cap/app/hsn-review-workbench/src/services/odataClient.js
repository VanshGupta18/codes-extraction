/**
 * OData Client — HSN Review Workbench
 *
 * All functions use relative-path fetch calls.
 * In dev: Vite proxy forwards /odata → http://localhost:4004
 *         Vite proxy forwards /api   → http://localhost:8000
 */

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Fetch the materials queue with HSN candidates and status.
 */
export async function fetchMaterialQueue() {
  const [resLegacy, resMara, resMakt, resCands] = await Promise.all([
    fetch('/odata/v4/hsn/ZMM_MAT_LEGACY?$filter=HSN eq \'9999\'&$select=Material,ZZ1_MM_RP_PLT,Legacy_Serial_number'),
    fetch('/odata/v4/hsn/MARA?$select=MaterialNumber,MaterialGroup,MaterialType'),
    fetch('/odata/v4/hsn/MAKT?$filter=Language eq \'EN\'&$select=MaterialNumber,Description'),
    fetch('/odata/v4/hsn/CandidateSuggestions?$orderby=Rank asc'),
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
    if (!mara) continue; // MARA is source of truth — skip orphan legacy rows

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
      // If we have AI candidates, set status to AI-Assist
      mat.status = 'AI-Assist';
    }
  }

  return Array.from(uniqueMaterials.values());
}

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Approve an AI-proposed or already-validated HSN for a material.
 * @param {string} materialId
 * @param {string} hsn - 8-digit HSN code
 */
export async function approveHsn(materialId, hsn) {
  const res = await fetch('/api/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialNumber: materialId, chosenCode: hsn }),
  });
  if (!res.ok) {
    throw new Error('Failed to approve HSN code via FastAPI.');
  }
  return { success: true };
}

/**
 * Submit a manually entered HSN code with an audit reason.
 * @param {string} materialId
 * @param {string} hsn - Manually entered 8-digit HSN code
 * @param {string} reason - Audit trail reason text
 */
export async function submitManualHsn(materialId, hsn, reason) {
  // For now, our FastAPI endpoint handles manual entries exactly the same way.
  // We just send the chosen code.
  return approveHsn(materialId, hsn);
}

/**
 * Bulk approve a list of materials with their current top HSN candidate.
 * @param {string[]} materialIds
 */
export async function bulkApprove(materialIds) {
  for (const matId of materialIds) {
    // 1. Fetch the top-ranked candidate for this material
    const res = await fetch(`/odata/v4/hsn/CandidateSuggestions?$filter=MaterialNumber eq '${matId}' and Rank eq 1`);
    const json = await res.json();
    
    // 2. Approve it
    if (json.value && json.value.length > 0) {
      const topHsn = json.value[0].CandidateCode;
      await approveHsn(matId, topHsn);
    }
  }
  return { success: true, count: materialIds.length };
}

/**
 * Add a legacy material entry manually.
 */
export async function addLegacyMaterial(materialData) {
  const response = await fetch('/odata/v4/hsn/ZMM_MAT_LEGACY', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(materialData),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OData error: ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch all master data.
 */
export async function fetchAllMasterData() {
  const response = await fetch('/odata/v4/hsn/ZMM_MAT_LEGACY?$top=5000');
  if (!response.ok) {
    throw new Error('Failed to fetch master data');
  }
  const data = await response.json();
  
  const uniqueMaterials = new Map();
  for (const row of data.value) {
    if (!row.Material) continue;
    
    if (!uniqueMaterials.has(row.Material)) {
      uniqueMaterials.set(row.Material, row);
    } else {
      // If we encounter a duplicate, prefer the one with a real HSN if the existing is still pending
      const existing = uniqueMaterials.get(row.Material);
      if (existing.HSN === '9999' && row.HSN !== '9999') {
        uniqueMaterials.set(row.Material, row);
      }
    }
  }
  
  return Array.from(uniqueMaterials.values());
}

/**
 * Fetch detailed raw records for a given Material from both Legacy and Approved tables
 */
export async function fetchMaterialDetails(materialId) {
  const enc = encodeURIComponent(materialId);
  const [resLeg, resApp] = await Promise.all([
    fetch(`/odata/v4/hsn/ZMM_MAT_LEGACY?$filter=Material eq '${enc}'`),
    fetch(`/odata/v4/hsn/ZMM_MAT_APPROVED?$filter=Material eq '${enc}'`)
  ]);
  
  const legacyData = resLeg.ok ? await resLeg.json() : { value: [] };
  const approvedData = resApp.ok ? await resApp.json() : { value: [] };
  
  return {
    legacy: legacyData.value,
    approved: approvedData.value
  };
}

/**
 * Triggers the batch ranking job (BM25) for all pending legacy materials.
 */
export async function triggerBatchPipeline() {
  const res = await fetch('/api/trigger_batch', {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to trigger batch job.');
  }
  return await res.json();
}

/**
 * Rank one material and write top-3 to CandidateSuggestions (used after manual ingest).
 */
export async function rankMaterial(materialId) {
  const res = await fetch(`/api/rank/${encodeURIComponent(materialId)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to rank material ${materialId}.`);
  }
  return res.json();
}

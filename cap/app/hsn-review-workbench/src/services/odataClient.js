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
  // 1. Fetch legacy materials queue (only those that are still 9999)
  const resLegacy = await fetch('/odata/v4/hsn/ZMM_MAT_LEGACY?$filter=HSN eq \'9999\'&$select=Material,Material_Description,Material_Type,Material_Group,ZZ1_MM_RP_PLT,Legacy_Serial_number');
  if (!resLegacy.ok) throw new Error('Failed to fetch legacy materials');
  const jsonLegacy = await resLegacy.json();
  
  // 2. Group by Material since the legacy table may have duplicates for the same Material
  const uniqueMaterials = new Map();
  for (const row of jsonLegacy.value) {
    if (!uniqueMaterials.has(row.Material)) {
      uniqueMaterials.set(row.Material, {
        materialId: row.Material,
        materialType: row.Material_Type,
        description: row.Material_Description,
        category: row.Material_Group, // mapped loosely
        group: row.Material_Group,
        plant: row.ZZ1_MM_RP_PLT || 'N/A',
        hsnCandidates: [],
        status: 'Pending',
        reviewedBy: null,
        lastModified: new Date().toISOString()
      });
    }
  }

  // 3. Fetch candidate suggestions
  const resCands = await fetch('/odata/v4/hsn/CandidateSuggestions?$orderby=Rank asc');
  if (!resCands.ok) throw new Error('Failed to fetch candidate suggestions');
  const jsonCands = await resCands.json();
  
  // 4. Attach candidates to materials
  for (const cand of jsonCands.value) {
    if (uniqueMaterials.has(cand.MaterialNumber)) {
      const mat = uniqueMaterials.get(cand.MaterialNumber);
      mat.hsnCandidates.push({
        hsn: cand.CandidateCode,
        confidence: cand.Score,
        source: cand.Rank === 1 ? 'MARA Affinity Match' : 'Semantic AI Match'
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
 * Triggers the AI batch pipeline job in the FastAPI backend.
 */
export async function triggerBatchJob() {
  const res = await fetch('/api/trigger_batch', {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to trigger batch job.');
  }
  return await res.json();
}

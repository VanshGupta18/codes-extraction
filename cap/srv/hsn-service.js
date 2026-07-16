const cds = require('@sap/cds');
const { registerVectorHandlers } = require('./vector-handlers');

const LOOKUP = process.env.LOOKUP_SERVICE_URL || 'http://localhost:8000';

async function callLookup(path, options = {}) {
  const res = await fetch(`${LOOKUP}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Lookup service unreachable at ${LOOKUP}${path} (${res.status}): ${text || res.statusText}. ` +
      'Start lookup-service: cd lookup-service && uvicorn main:app --port 8000',
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

module.exports = cds.service.impl(function () {
  const { CandidateSuggestions, ZMM_MAT_LEGACY } = cds.entities('hsn');

  registerVectorHandlers(this);

  this.before('CREATE', 'ZMM_MAT_LEGACY', async (req) => {
    const row = req.data;
    row.Material = (row.Material || '').trim();
    row.Material_Description = (row.Material_Description || '').trim();
    row.Material_Type = (row.Material_Type || '').trim();
    row.Material_Group = (row.Material_Group || '').trim();

    if (!row.Material) return req.reject(400, 'Material is required');
    if (!row.Material_Description) return req.reject(400, 'Material description is required');
    if (!row.Material_Type) return req.reject(400, 'Material type is required');
    if (!row.Material_Group) return req.reject(400, 'Material group is required');

    row.Legacy_Serial_number = row.Legacy_Serial_number || `LEGACY-${Date.now()}`;
    row.HSN = '9999';
    row.Effective_Till_Date = row.Effective_Till_Date || '9999-12-31';
    row.Numerator = row.Numerator || '1';
    row.Denominator = row.Denominator || '1';
    if (!(row.Material_Description_1 || '').trim()) {
      row.Material_Description_1 = row.Material_Description;
    }

    const pending = await SELECT.one.from(ZMM_MAT_LEGACY).where({
      Material: row.Material,
      HSN: '9999',
    });
    if (pending) {
      return req.reject(409, `Material ${row.Material} is already pending classification`);
    }
  });

  this.on('replaceCandidateSuggestions', async (req) => {
    const { materialNumber, candidatesJson } = req.data;
    let candidates;
    try {
      candidates = JSON.parse(candidatesJson || '[]');
    } catch {
      return req.reject(400, 'candidatesJson must be valid JSON');
    }

    const entries = candidates.map((candidate) => ({
      MaterialNumber: materialNumber,
      Rank: candidate.Rank,
      CandidateCode: candidate.CandidateCode,
      Score: candidate.Score,
    }));

    const tx = cds.tx(req);
    await tx.delete(CandidateSuggestions).where({ MaterialNumber: materialNumber });
    if (entries.length) {
      await tx.insert(entries).into(CandidateSuggestions);
    }
    return entries.length;
  });

  this.on('triggerBatch', async () => {
    const result = await callLookup('/trigger_batch', { method: 'POST' });
    return result?.message ?? 'Batch started';
  });

  this.on('rankMaterial', async (req) => {
    const { materialNumber } = req.data;
    await callLookup(`/rank/${encodeURIComponent(materialNumber)}`, { method: 'POST' });
    return 'Ranked';
  });

  this.on('approveMaterial', async (req) => {
    const { materialNumber, chosenCode } = req.data;
    await callLookup('/approve', {
      method: 'POST',
      body: JSON.stringify({ materialNumber, chosenCode }),
    });
    return 'Approved';
  });
});

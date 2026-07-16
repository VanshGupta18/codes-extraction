const cds = require('@sap/cds');

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
  const { CandidateSuggestions } = cds.entities('hsn');

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

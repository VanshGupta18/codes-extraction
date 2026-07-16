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

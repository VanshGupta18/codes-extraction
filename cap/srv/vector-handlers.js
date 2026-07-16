const cds = require('@sap/cds');

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function toVectorLiteral(values) {
  return `[${values.map((v) => Number(v)).join(',')}]`;
}

function tableName() {
  return 'HSN_TARIFFCORPUSEMBEDDING';
}

async function registerVectorHandlers(srv) {
  const { SystemMetadata } = cds.entities('hsn');
  const embedTable = tableName();

  srv.on('fetchCorpusSimilarity', async (req) => {
    const embedding = parseJson(req.data.embeddingJson, []);
    const sources = parseJson(req.data.sourcesJson, []);
    const codes = parseJson(req.data.codesJson, []);

    if (!Array.isArray(embedding) || embedding.length === 0 || !sources.length || !codes.length) {
      return JSON.stringify([]);
    }

    const vectorLiteral = toVectorLiteral(embedding);
    const db = await cds.connect.to('db');
    const sourcePh = sources.map(() => '?').join(', ');
    const codePh = codes.map(() => '?').join(', ');

    const rows = await db.run(
      `SELECT CODE, DESCRIPTION, SOURCE,
              COSINE_SIMILARITY(EMBEDDING, TO_REAL_VECTOR(?)) AS COSINE_SCORE
       FROM ${embedTable}
       WHERE SOURCE IN (${sourcePh})
         AND CODE IN (${codePh})
       ORDER BY COSINE_SCORE DESC`,
      [vectorLiteral, ...sources, ...codes],
    );

    const result = (rows || []).map((row) => ({
      code: row.CODE ?? row.Code,
      description: row.DESCRIPTION ?? row.Description,
      source: row.SOURCE ?? row.Source,
      cosineScore: Number(row.COSINE_SCORE ?? row.cosineScore ?? 0),
    }));

    return JSON.stringify(result);
  });

  srv.on('upsertTariffEmbeddings', async (req) => {
    const batch = parseJson(req.data.batchJson, []);
    if (!Array.isArray(batch) || batch.length === 0) {
      return 0;
    }

    const tx = cds.tx(req);
    let count = 0;

    for (const row of batch) {
      const code = row.code || row.Code;
      const source = row.source || row.Source;
      const description = row.description || row.Description || '';
      const descriptionHash = row.descriptionHash || row.DescriptionHash || '';
      const model = row.model || row.Model || 'BAAI/bge-small-en-v1.5';
      const embedding = row.embedding || row.Embedding;
      if (!code || !source || !Array.isArray(embedding) || embedding.length === 0) {
        continue;
      }

      const vectorLiteral = toVectorLiteral(embedding);
      const embeddedAt = new Date().toISOString();

      // CDS tx.insert cannot bind JS arrays to REAL_VECTOR — use native SQL.
      await tx.run(
        `DELETE FROM ${embedTable} WHERE CODE = ? AND SOURCE = ?`,
        [code, source],
      );
      await tx.run(
        `INSERT INTO ${embedTable}
           (CODE, SOURCE, DESCRIPTION, DESCRIPTIONHASH, MODEL, EMBEDDEDAT, EMBEDDING)
         VALUES (?, ?, ?, ?, ?, ?, TO_REAL_VECTOR(?))`,
        [code, source, description, descriptionHash, model, embeddedAt, vectorLiteral],
      );
      count += 1;
    }

    return count;
  });

  srv.on('countTariffEmbeddings', async () => {
    const db = await cds.connect.to('db');
    const rows = await db.run(`SELECT COUNT(*) AS CNT FROM ${embedTable}`);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return Number(row?.CNT ?? row?.cnt ?? 0);
  });

  srv.on('setSystemMetadata', async (req) => {
    const { id, value } = req.data;
    const tx = cds.tx(req);
    await tx.delete(SystemMetadata).where({ id });
    await tx.insert({
      id,
      value: value ?? '',
      updatedAt: new Date().toISOString(),
    }).into(SystemMetadata);
    return value ?? '';
  });

  srv.on('getSystemMetadata', async (req) => {
    const row = await SELECT.one.from(SystemMetadata).where({ id: req.data.id });
    return row?.value ?? '';
  });
}

module.exports = { registerVectorHandlers };

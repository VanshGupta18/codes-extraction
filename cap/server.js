const cds = require('@sap/cds');
const http = require('http');
const https = require('https');

/** Browser → POST /api/trigger_batch → lookup-service :8000 (same as working curl). */
cds.on('bootstrap', (app) => {
  const lookupTarget = process.env.LOOKUP_SERVICE_URL || 'http://localhost:8000';
  const lookupOrigin = new URL(lookupTarget);
  const transport = lookupOrigin.protocol === 'https:' ? https : http;

  app.use('/api', (req, res) => {
    const path = req.originalUrl.replace(/^\/api/, '') || '/';
    const headers = { ...req.headers, host: lookupOrigin.host };
    delete headers.connection;

    const proxyReq = transport.request(
      {
        hostname: lookupOrigin.hostname,
        port: lookupOrigin.port || (lookupOrigin.protocol === 'https:' ? 443 : 80),
        path,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Lookup service unreachable',
          detail: err.message,
          hint: 'cd lookup-service && uvicorn main:app --port 8000',
        });
      }
    });

    req.pipe(proxyReq);
  });
});

module.exports = cds.server;

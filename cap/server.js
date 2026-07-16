const cds = require('@sap/cds');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const express = require('express');

/** Browser → POST /api/* → lookup-service; serve React dist for SPA in production. */
cds.on('bootstrap', (app) => {
  const dist = path.join(__dirname, 'app/hsn-review-workbench/dist');
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(dist));
    app.get(/^(?!\/odata|\/api).*$/, (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.sendFile(indexHtml, (err) => err && next(err));
    });
  }

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

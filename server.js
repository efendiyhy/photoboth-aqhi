#!/usr/bin/env node
/*
 * Server statis super ringan untuk Photobooth AQHI Lab.
 * - Tanpa dependensi (hanya modul bawaan Node, kompatibel Node >= 12)
 * - Hanya melayani GET/HEAD: tidak ada upload, foto TIDAK PERNAH sampai ke server
 * - HTTP  : PORT       (default 8080)
 * - HTTPS : HTTPS_PORT (default 8443) -- aktif otomatis jika certs/server.key & certs/server.crt ada
 *           (HTTPS diperlukan agar kamera HP bisa diakses lewat IP hotspot)
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '8443', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CERT_KEY = process.env.TLS_KEY || path.join(__dirname, 'certs', 'server.key');
const CERT_CRT = process.env.TLS_CERT || path.join(__dirname, 'certs', 'server.crt');
const RESERVED = [5000]; // sudah dipakai layanan lain di Orange Pi

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

for (const p of [PORT, HTTPS_PORT]) {
  if (RESERVED.indexOf(p) !== -1) {
    console.error('Port ' + p + ' dipakai layanan lain. Pilih port lain (mis. 8080).');
    process.exit(1);
  }
}

const hasTls = fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT);

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=()'
  }, headers || {}));
  res.end(body);
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    return send(res, 400, 'Bad Request');
  }

  if (urlPath === '/api/info') {
    return send(res, 200, JSON.stringify({ app: 'photobooth-aqhi', httpsPort: hasTls ? HTTPS_PORT : null }), {
      'Content-Type': MIME['.json'],
      'Cache-Control': 'no-store'
    });
  }
  if (urlPath === '/healthz') return send(res, 200, 'ok', { 'Content-Type': MIME['.txt'] });

  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (filePath.indexOf(PUBLIC_DIR + path.sep) !== 0) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': MIME['.txt'] });
    const ext = path.extname(filePath).toLowerCase();
    const isTemplate = filePath.indexOf(path.join(PUBLIC_DIR, 'templates') + path.sep) === 0;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      // template jarang berubah; kode aplikasi selalu divalidasi ulang supaya update langsung terlihat
      'Cache-Control': isTemplate && ext === '.png' ? 'public, max-age=86400' : 'no-cache'
    };
    res.writeHead(200, Object.assign({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=()'
    }, headers));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  });
}

function listen(server, port, label) {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('Port ' + port + ' sudah dipakai. Jalankan dengan port lain, mis.: PORT=8000 node server.js');
    } else {
      console.error(e);
    }
    process.exit(1);
  });
  server.listen(port, HOST, () => console.log('[AQHI Photobooth] ' + label + ' di ' + HOST + ':' + port));
}

listen(http.createServer(handler), PORT, 'HTTP ');
if (hasTls) {
  listen(https.createServer({ key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) }, handler), HTTPS_PORT, 'HTTPS');
} else {
  console.log('[AQHI Photobooth] HTTPS nonaktif (belum ada certs/). Jalankan: bash scripts/gen-cert.sh');
}

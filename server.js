#!/usr/bin/env node
/*
 * Server Photobooth AQHI Lab (berjalan di Orange Pi, kamera terpasang di Orange Pi).
 *
 * - Tanpa dependensi npm (hanya modul bawaan Node >= 12 + program `ffmpeg`)
 * - Kamera (USB/UVC, /dev/videoN) dibaca ffmpeg -> frame JPEG terbaru HANYA disimpan di memori
 *     GET /api/stream?cam=0    preview langsung (MJPEG)
 *     GET /api/snapshot?cam=0  satu frame JPEG segar (tidak ditulis ke disk)
 *     GET /api/status          daftar kamera
 * - Penggabungan template + unduhan tetap 100% di browser pengguna (zero server storage)
 * - Kamera hanya menyala saat ada yang memakai (hemat CPU), mati otomatis setelah idle
 *
 * Env: PORT=8080  CAMERA_DEVICES=/dev/video0[,/dev/video2]  CAMERA_SIZE=1280x720  CAMERA_FPS=15
 *      CAMERA_INPUT=mjpeg|auto   (auto = biarkan ffmpeg memilih format, untuk kamera non-MJPEG)
 *      CAMERA_DEVICES=test  -> pola uji tanpa kamera (untuk pengembangan)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEVICES = (process.env.CAMERA_DEVICES || '/dev/video0').split(',').map((s) => s.trim()).filter(Boolean);
const SIZE = process.env.CAMERA_SIZE || '1280x720';
const FPS = process.env.CAMERA_FPS || '15';
const INPUT_MODE = process.env.CAMERA_INPUT || 'mjpeg';
const IDLE_MS = 8000;
const RESERVED = [5000]; // sudah dipakai layanan lain di Orange Pi

if (RESERVED.indexOf(PORT) !== -1) {
  console.error('Port ' + PORT + ' dipakai layanan lain. Pilih port lain (mis. 8080).');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

// ---------------------------------------------------------------- kamera
class Camera {
  constructor(id, device) {
    this.id = id;
    this.device = device;
    this.proc = null;
    this.frame = null;        // frame JPEG terbaru (hanya di memori)
    this.frameAt = 0;
    this.buf = Buffer.alloc(0);
    this.viewers = new Set(); // response stream MJPEG
    this.waiters = [];        // permintaan snapshot yang menunggu frame berikutnya
    this.lastUse = 0;
    this.mode = INPUT_MODE === 'auto' ? 1 : 0;
    this.lastError = '';
    this.startedAt = 0;
  }

  args() {
    const base = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (this.device === 'test') {
      return base.concat(['-re', '-f', 'lavfi', '-i', 'testsrc2=size=' + SIZE + ':rate=' + FPS,
        '-c:v', 'mjpeg', '-q:v', '4', '-f', 'mjpeg', 'pipe:1']);
    }
    if (this.mode === 0) { // kamera menghasilkan MJPEG: salin langsung, CPU ~0
      return base.concat(['-f', 'v4l2', '-input_format', 'mjpeg', '-video_size', SIZE, '-framerate', FPS,
        '-i', this.device, '-an', '-c:v', 'copy', '-bsf:v', 'mjpeg2jpeg', '-f', 'mjpeg', 'pipe:1']);
    }
    return base.concat(['-f', 'v4l2', '-video_size', SIZE, '-framerate', FPS, '-i', this.device,
      '-an', '-c:v', 'mjpeg', '-q:v', '4', '-pix_fmt', 'yuvj422p', '-f', 'mjpeg', 'pipe:1']);
  }

  start() {
    if (this.proc) return;
    this.buf = Buffer.alloc(0);
    this.startedAt = Date.now();
    let p;
    try {
      p = spawn('ffmpeg', this.args(), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.lastError = 'ffmpeg tidak bisa dijalankan: ' + e.message;
      return;
    }
    this.proc = p;
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-600); });
    p.stdout.on('data', (d) => this.onData(d));
    p.on('error', (e) => {
      this.lastError = e.code === 'ENOENT' ? 'ffmpeg belum terpasang (sudo apt install ffmpeg)' : String(e.message);
      this.proc = null;
      this.flushWaiters(null);
    });
    p.on('close', () => {
      const quick = Date.now() - this.startedAt < 3000;
      if (this.proc === p) this.proc = null;
      this.frame = null;
      if (err.trim()) this.lastError = err.trim().split('\n').pop();
      if (quick && this.mode === 0 && this.device !== 'test' && !this.frameAt) {
        this.mode = 1; // kamera tidak mendukung MJPEG -> coba format bawaan + encode
        console.log('[' + this.device + '] MJPEG tidak didukung, beralih ke mode encode');
        if (this.wanted()) this.start();
        return;
      }
      this.flushWaiters(null);
      if (this.wanted() && !quick) setTimeout(() => this.wanted() && this.start(), 1000);
    });
  }

  stop() {
    if (this.proc) { this.proc.kill('SIGTERM'); this.proc = null; }
    this.frame = null;
  }

  wanted() { return this.viewers.size > 0 || this.waiters.length > 0 || Date.now() - this.lastUse < IDLE_MS; }

  touch() { this.lastUse = Date.now(); if (!this.proc) this.start(); }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const s = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
      if (s < 0) { this.buf = Buffer.alloc(0); return; }
      const e = this.buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
      if (e < 0) { if (s > 0) this.buf = this.buf.slice(s); return; }
      const jpg = Buffer.from(this.buf.slice(s, e + 2)); // salinan
      this.buf = this.buf.slice(e + 2);
      this.frame = jpg; this.frameAt = Date.now(); this.lastError = '';
      this.flushWaiters(jpg);
      this.broadcast(jpg);
    }
    if (this.buf.length > 8 * 1024 * 1024) this.buf = Buffer.alloc(0);
  }

  flushWaiters(jpg) {
    const w = this.waiters; this.waiters = [];
    w.forEach((fn) => fn(jpg));
  }

  broadcast(jpg) {
    this.viewers.forEach((res) => {
      if (res.writableLength > jpg.length * 2) return; // klien lambat: lewati frame
      res.write('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpg.length + '\r\n\r\n');
      res.write(jpg);
      res.write('\r\n');
    });
  }

  // frame BARU (diambil setelah permintaan masuk)
  snapshot(timeoutMs) {
    this.touch();
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((f) => f !== cb); resolve(null); }, timeoutMs || 5000);
      const cb = (jpg) => { clearTimeout(t); resolve(jpg); };
      this.waiters.push(cb);
    });
  }
}

const cameras = DEVICES.map((d, i) => new Camera(i, d));
setInterval(() => cameras.forEach((c) => { if (c.proc && !c.wanted()) { c.stop(); } }), 2000);
function shutdown() { cameras.forEach((c) => c.stop()); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

// ---------------------------------------------------------------- http
function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({}, SEC_HEADERS, headers || {}));
  res.end(body);
}
function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
}

function handleApi(req, res, pathname, query) {
  if (pathname === '/api/status') {
    return json(res, 200, {
      app: 'photobooth-aqhi',
      cameras: cameras.map((c) => ({ id: c.id, device: c.device, active: !!c.proc, error: c.lastError || null }))
    });
  }
  const cam = cameras[parseInt(query.get('cam') || '0', 10)];
  if (!cam) return json(res, 404, { error: 'kamera tidak ada' });

  if (pathname === '/api/snapshot') {
    cam.snapshot(5000).then((jpg) => {
      if (!jpg) return json(res, 503, { error: cam.lastError || 'kamera tidak memberi gambar' });
      send(res, 200, jpg, { 'Content-Type': 'image/jpeg', 'Content-Length': jpg.length, 'Cache-Control': 'no-store' });
    });
    return;
  }
  if (pathname === '/api/stream') {
    res.writeHead(200, Object.assign({}, SEC_HEADERS, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Connection: 'close'
    }));
    cam.viewers.add(res);
    cam.touch();
    if (cam.frame) cam.broadcast(cam.frame);
    req.on('close', () => { cam.viewers.delete(res); cam.lastUse = Date.now(); });
    return;
  }
  json(res, 404, { error: 'tidak ditemukan' });
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

  let u;
  try { u = new URL(req.url, 'http://x'); } catch (e) { return send(res, 400, 'Bad Request'); }
  let urlPath;
  try { urlPath = decodeURIComponent(u.pathname); } catch (e) { return send(res, 400, 'Bad Request'); }

  if (urlPath.indexOf('/api/') === 0) return handleApi(req, res, urlPath, u.searchParams);
  if (urlPath === '/healthz') return send(res, 200, 'ok', { 'Content-Type': MIME['.txt'] });

  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (filePath.indexOf(PUBLIC_DIR + path.sep) !== 0) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': MIME['.txt'] });
    const ext = path.extname(filePath).toLowerCase();
    const isTpl = filePath.indexOf(path.join(PUBLIC_DIR, 'templates') + path.sep) === 0 && ext === '.png';
    res.writeHead(200, Object.assign({}, SEC_HEADERS, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isTpl ? 'public, max-age=86400' : 'no-cache'
    }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  });
}

const server = http.createServer(handler);
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? 'Port ' + PORT + ' sudah dipakai. Jalankan dengan port lain, mis.: PORT=8000 node server.js' : e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log('[AQHI Photobooth] http://' + HOST + ':' + PORT + '  kamera: ' + DEVICES.join(', ') + ' (' + SIZE + '@' + FPS + ')');
});

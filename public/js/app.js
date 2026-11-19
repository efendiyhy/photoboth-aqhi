/* Photobooth AQHI Lab - semua proses (kamera, penggabungan, unduh) terjadi di browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var screens = { templates: $('screen-templates'), camera: $('screen-camera'), preview: $('screen-preview') };

  var state = {
    templates: [],
    tpl: null,
    tplImg: null,
    photos: [],          // canvas per slot (hanya di memori)
    mirror: true,
    sound: true,
    timer: 5,
    stream: null,
    running: false,
    cancel: false,
    streamOk: false,
    effect: 'none',
    categories: [],
    category: 'all',
    camCount: 1,
    camIndex: 0,
    resultBlob: null
  };

  // ---------- util ----------
  function store(k, v) { try { localStorage.setItem('aqhi.' + k, v); } catch (e) {} }
  function load(k, d) { try { var v = localStorage.getItem('aqhi.' + k); return v === null ? d : v; } catch (e) { return d; } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 3000);
  }
  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('active', k === name); });
    document.body.setAttribute('data-screen', name);
    window.scrollTo(0, 0);
  }

  var actx = null;
  function getCtx() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; }
    return actx;
  }
  function unlockAudio() { getCtx(); } // dipanggil dari tap pengguna supaya iOS/Android mengizinkan suara

  function beep(freq, dur, vol) {
    if (!state.sound) return;
    var ctx = getCtx(); if (!ctx) return;
    try {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq; g.gain.value = vol || 0.12;
      o.connect(g); g.connect(ctx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.stop(ctx.currentTime + dur);
    } catch (e) {}
  }

  // Suara "cekrek" kamera: dua klik mekanis (noise terfilter) + dentuman kecil
  function playShutter(ctx, dest, t) {
    var len = Math.floor(ctx.sampleRate * 0.12), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    [[0, 3200, 0.03, 0.9], [0.07, 1800, 0.05, 0.75]].forEach(function (c) {
      var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = c[1]; f.Q.value = 0.9;
      g.gain.setValueAtTime(c[3], t + c[0]); g.gain.exponentialRampToValueAtTime(0.001, t + c[0] + c[2]);
      src.connect(f); f.connect(g); g.connect(dest); src.start(t + c[0]); src.stop(t + c[0] + c[2] + 0.02);
    });
    var o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.08);
  }
  function shutter() {
    if (!state.sound) return;
    var ctx = getCtx(); if (!ctx) return;
    try { playShutter(ctx, ctx.destination, ctx.currentTime); } catch (e) {}
  }
  window.__aqhiPlayShutter = playShutter; // untuk pengujian

  // ---------- efek foto ----------
  // Semua efek memakai pixel-processing canvas (jalan di semua browser). Efek 'glow' butuh ctx.filter, hanya ditampilkan bila didukung.
  function canvasFilterOk() {
    try { var x = document.createElement('canvas').getContext('2d'); x.filter = 'blur(1px)'; return x.filter === 'blur(1px)'; } catch (e) { return false; }
  }
  var CSS_OK = !!(window.CSS && CSS.supports && CSS.supports('filter', 'grayscale(1)'));
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function sat(r, g, b, k) { var l = 0.299 * r + 0.587 * g + 0.114 * b; return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k]; }
  function con(v, k) { return (v - 128) * k + 128; }
  function sepiaPx(r, g, b) { return [0.393 * r + 0.769 * g + 0.189 * b, 0.349 * r + 0.686 * g + 0.168 * b, 0.272 * r + 0.534 * g + 0.131 * b]; }

  var EFFECTS = [
    { id: 'none', name: 'Normal', emoji: '🌈', css: '' },
    { id: 'bw', name: 'Hitam Putih', emoji: '🖤', css: 'grayscale(1) contrast(1.1)', px: function (r, g, b) { var l = 0.299 * r + 0.587 * g + 0.114 * b; l = con(l, 1.1); return [l, l, l]; } },
    { id: 'sepia', name: 'Sepia', emoji: '🟤', css: 'sepia(1)', px: sepiaPx },
    { id: 'vivid', name: 'Cerah', emoji: '🌟', css: 'saturate(1.5) contrast(1.08)', px: function (r, g, b) { var s = sat(r, g, b, 1.5); return [con(s[0], 1.08), con(s[1], 1.08), con(s[2], 1.08)]; } },
    { id: 'warm', name: 'Hangat', emoji: '🧡', css: 'sepia(.3) saturate(1.3) brightness(1.03)', px: function (r, g, b) { return [r * 1.1 + 4, g * 1.03, b * 0.86]; } },
    { id: 'cool', name: 'Sejuk', emoji: '💙', css: 'saturate(1.1) hue-rotate(-12deg)', px: function (r, g, b) { return [r * 0.9, g * 1.0, b * 1.12 + 4]; } },
    { id: 'pink', name: 'Pink', emoji: '🌸', css: 'hue-rotate(-25deg) saturate(1.25) brightness(1.05)', px: function (r, g, b) { var s = sat(r * 1.08 + 8, g * 0.96, b * 1.04 + 6, 1.1); return s; } },
    { id: 'cyan', name: 'Biru Sains', emoji: '🧪', css: 'grayscale(1) sepia(1) hue-rotate(150deg) saturate(2)', px: function (r, g, b) { var l = 0.299 * r + 0.587 * g + 0.114 * b; return [l * 0.55, l * 0.95, l * 1.12 + 10]; } },
    { id: 'retro', name: 'Retro', emoji: '📼', css: 'sepia(.5) contrast(.92) brightness(1.05)', vignette: 0.5, px: function (r, g, b) { var s = sepiaPx(r, g, b); return [con((r + s[0]) / 2, 0.92) + 8, con((g + s[1]) / 2, 0.92) + 8, con((b + s[2]) / 2, 0.92) + 8]; } },
    { id: 'pop', name: 'Pop Art', emoji: '🎨', css: 'saturate(1.8) contrast(1.3)', px: function (r, g, b) { var s = sat(r, g, b, 1.7); return s.map(function (v) { return Math.round(cl(v) / 255 * 4) / 4 * 255; }); } },
    { id: 'glow', name: 'Glow', emoji: '✨', css: 'brightness(1.08) contrast(.95)', blur: true, px: function (r, g, b) { var s = sat(r * 1.05 + 6, g * 1.05 + 6, b * 1.05 + 6, 1.08); return s; } }
  ];
  var BLUR_OK = canvasFilterOk();
  EFFECTS = EFFECTS.filter(function (e) { return !e.blur || BLUR_OK; });
  function effectById(id) { for (var i = 0; i < EFFECTS.length; i++) if (EFFECTS[i].id === id) return EFFECTS[i]; return EFFECTS[0]; }

  function applyEffect(src, id) {
    var e = effectById(id);
    if (!e.px) return src;
    var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    if (e.blur && BLUR_OK) { ctx.save(); ctx.filter = 'blur(' + Math.max(2, Math.round(src.width / 220)) + 'px)'; ctx.globalAlpha = 0.45; ctx.drawImage(src, 0, 0); ctx.restore(); }
    var img = ctx.getImageData(0, 0, c.width, c.height), d = img.data, w = c.width, h = c.height;
    var cx = w / 2, cy = h / 2, maxd = Math.sqrt(cx * cx + cy * cy);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      var o = e.px(d[i], d[i + 1], d[i + 2]), k = 1;
      if (e.vignette) { var x = p % w, y = (p / w) | 0, dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxd; k = 1 - e.vignette * dist * dist; }
      d[i] = cl(o[0] * k); d[i + 1] = cl(o[1] * k); d[i + 2] = cl(o[2] * k);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function buildFx() {
    ['fx-chips', 'fx-chips2'].forEach(function (id) {
      var box = $(id); box.innerHTML = '';
      EFFECTS.forEach(function (e) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'fx-chip' + (e.id === state.effect ? ' on' : '');
        b.dataset.fx = e.id; b.textContent = e.emoji + ' ' + e.name; b.setAttribute('role', 'option');
        b.addEventListener('click', function () { setEffect(e.id); });
        box.appendChild(b);
      });
    });
  }

  function setEffect(id) {
    state.effect = id; store('fx', id);
    Array.prototype.forEach.call(document.querySelectorAll('.fx-chip'), function (b) { b.classList.toggle('on', b.dataset.fx === id); });
    $('feed').style.filter = CSS_OK ? effectById(id).css : '';
    if (screens.preview.classList.contains('active') && state.tplImg) { compose(); state.resultBlob = null; }
  }

  // ---------- konfeti ----------
  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = $('confetti'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    var em = ['✨', '💙', '☁️', '🧪', '🌿', '⭐', '🫧'], cols = ['#01cbff', '#ffcb00', '#ff9835', '#fd6866', '#3fd6c4', '#ff8fb1'];
    var ps = [];
    for (var i = 0; i < 70; i++) ps.push({ x: Math.random() * c.width, y: -Math.random() * c.height * 0.4, vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, s: (14 + Math.random() * 14) * dpr, e: Math.random() < 0.45 ? em[(Math.random() * em.length) | 0] : null, c: cols[(Math.random() * cols.length) | 0] });
    var t0 = performance.now();
    (function frame(t) {
      var el = t - t0; ctx.clearRect(0, 0, c.width, c.height);
      ps.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - el / 2600);
        if (p.e) { ctx.font = p.s + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.e, 0, 0); }
        else { ctx.fillStyle = p.c; ctx.fillRect(-p.s / 3, -p.s / 6, p.s * 0.66, p.s / 3); }
        ctx.restore();
      });
      if (el < 2600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
    })(t0);
  }

  // ---------- template ----------
  function formatName(f) { return f === 'strip' ? 'Photo Strip' : f === '4r' ? '4R Portrait' : 'Square 1:1'; }

  function makeCard(t) {
    var card = document.createElement('button');
    card.className = 'card'; card.type = 'button';
    var wrap = document.createElement('div'); wrap.className = 'tpl';
    t.slots.forEach(function (s, i) {
      var d = document.createElement('div'); d.className = 'slot'; d.textContent = i + 1;
      d.style.cssText = 'left:' + (s.x / t.width * 100) + '%;top:' + (s.y / t.height * 100) + '%;width:' + (s.w / t.width * 100) + '%;height:' + (s.h / t.height * 100) + '%';
      wrap.appendChild(d);
    });
    var img = document.createElement('img');
    img.src = 'templates/' + t.file; img.alt = t.name; img.loading = 'lazy';
    img.width = t.width; img.height = t.height;
    wrap.appendChild(img);
    var h = document.createElement('h3'); h.textContent = t.name;
    var sm = document.createElement('small'); sm.textContent = t.slots.length + ' foto · ' + formatName(t.format);
    card.appendChild(wrap); card.appendChild(h); card.appendChild(sm);
    card.addEventListener('click', function () { chooseTemplate(t); });
    return card;
  }

  function renderTemplates() {
    var list = $('template-list'), bar = $('cat-bar');
    list.innerHTML = ''; bar.innerHTML = '';
    var cats = (state.categories || []).slice();
    var known = {}; cats.forEach(function (c) { known[c.id] = true; });
    var extra = state.templates.some(function (t) { return !known[t.category]; });
    if (extra) cats.push({ id: '_other', name: 'Lainnya', icon: '🎁' });
    var groups = {};
    state.templates.forEach(function (t) { var k = known[t.category] ? t.category : '_other'; (groups[k] = groups[k] || []).push(t); });
    cats = cats.filter(function (c) { return groups[c.id] && groups[c.id].length; });

    var chip = function (id, label, n) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cat-chip' + (state.category === id ? ' on' : '');
      b.dataset.cat = id; b.innerHTML = label + ' <small>' + n + '</small>';
      b.addEventListener('click', function () { state.category = id; store('cat', id); applyCategory(); window.scrollTo(0, 0); });
      bar.appendChild(b);
    };
    chip('all', '🎀 Semua', state.templates.length);
    cats.forEach(function (c) { chip(c.id, c.icon + ' ' + c.name, groups[c.id].length); });

    cats.forEach(function (c) {
      var sec = document.createElement('section'); sec.className = 'cat-section'; sec.dataset.cat = c.id;
      var h = document.createElement('h2'); h.className = 'cat-title'; h.innerHTML = c.icon + ' ' + c.name + ' <small>' + groups[c.id].length + ' template</small>';
      var grid = document.createElement('div'); grid.className = 'grid';
      groups[c.id].forEach(function (t) { grid.appendChild(makeCard(t)); });
      sec.appendChild(h); sec.appendChild(grid); list.appendChild(sec);
    });
    applyCategory();
  }

  function applyCategory() {
    var ok = false;
    Array.prototype.forEach.call(document.querySelectorAll('.cat-chip'), function (b) { var on = b.dataset.cat === state.category; if (on) ok = true; b.classList.toggle('on', on); });
    if (!ok) { state.category = 'all'; var f = document.querySelector('.cat-chip'); if (f) f.classList.add('on'); }
    Array.prototype.forEach.call(document.querySelectorAll('.cat-section'), function (s) {
      s.hidden = !(state.category === 'all' || s.dataset.cat === state.category);
      s.querySelector('.cat-title').hidden = state.category !== 'all';
    });
  }

  function chooseTemplate(t) {
    state.tpl = t;
    state.tplImg = null;
    var img = new Image();
    img.onload = function () { state.tplImg = img; };
    img.src = 'templates/' + t.file;
    startSession();
  }

  // ---------- kamera ----------
  function setBoxRatio(slot) {
    var box = $('cam-box');
    box.style.aspectRatio = slot.w + ' / ' + slot.h;
    box.style.setProperty('--ratio', String(slot.w / slot.h));
  }

  function stopStream() {
    state.streamOk = false;
    var f = $('feed');
    f.removeAttribute('src'); // menutup koneksi -> server mematikan kamera saat idle
  }

  function msg(text, kind) {
    var m = $('cam-msg');
    if (!text) { m.hidden = true; m.className = 'cam-msg'; return; }
    m.textContent = text; m.className = 'cam-msg' + (kind === 'err' ? ' err' : ''); m.hidden = false;
  }

  // Preview langsung dari kamera yang terpasang di Orange Pi (MJPEG)
  function startCamera() {
    stopStream();
    msg('⏳ Menyalakan kamera…');
    var f = $('feed');
    return new Promise(function (resolve) {
      var done = false, poll, timer;
      var finish = function (ok, text) {
        if (done) return; done = true; clearTimeout(timer); clearInterval(poll);
        f.onload = f.onerror = null;
        state.streamOk = ok;
        if (ok) { applyMirror(); msg(''); f.style.filter = CSS_OK ? effectById(state.effect).css : ''; }
        else {
          stopStream();
          msg(text || 'Kamera di Orange Pi tidak terdeteksi. Pastikan kamera USB terpasang, lalu tekan tombol Mulai untuk mencoba lagi.', 'err');
        }
        resolve(ok);
      };
      timer = setTimeout(function () { finish(false); }, 10000);
      // sebagian browser tidak memicu "load" untuk stream MJPEG -> cek juga lewat ukuran gambar
      poll = setInterval(function () { if (f.getAttribute('src') && f.naturalWidth > 0) finish(true); }, 150);
      f.onload = function () { finish(true); };
      f.onerror = function () { finish(false); };
      f.src = 'api/stream?cam=' + state.camIndex + '&t=' + Date.now();
    });
  }

  function applyMirror() {
    $('feed').classList.toggle('mirror', state.mirror);
    var b = $('btn-mirror');
    b.setAttribute('aria-pressed', String(state.mirror));
    b.textContent = '🪞 Mirror: ' + (state.mirror ? 'ON' : 'OFF');
  }

  function renderThumbs(current) {
    var box = $('thumbs'); box.innerHTML = '';
    state.tpl.slots.forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'thumb' + (state.photos[i] ? ' done' : '') + (i === current ? ' now' : '');
      if (state.photos[i]) {
        var im = document.createElement('img'); im.alt = 'Foto ' + (i + 1);
        im.src = state.photos[i].toDataURL('image/jpeg', 0.5);
        d.appendChild(im);
      } else { d.textContent = i + 1; }
      box.appendChild(d);
    });
    $('shot-pill').textContent = 'Foto ' + Math.min((current === undefined ? state.photos.length : current) + 1, state.tpl.slots.length) + ' / ' + state.tpl.slots.length;
  }

  function updateStartLabel() {
    var b = $('btn-start');
    if (state.running) { b.textContent = '✋ Batal'; return; }
    b.textContent = '✨ Mulai Foto!';
  }

  function startSession() {
    state.photos = [];
    state.running = false;
    state.cancel = false;
    setBoxRatio(state.tpl.slots[0]);
    renderThumbs(0);
    updateStartLabel();
    show('camera');
    startCamera().then(updateStartLabel);
  }

  // crop cover -> canvas ukuran slot
  function coverCanvas(src, sw, sh, slot, flip) {
    var c = document.createElement('canvas'); c.width = slot.w; c.height = slot.h;
    var ctx = c.getContext('2d');
    var scale = Math.max(slot.w / sw, slot.h / sh);
    var cw = slot.w / scale, ch = slot.h / scale;
    var sx = (sw - cw) / 2, sy = (sh - ch) / 2;
    ctx.imageSmoothingQuality = 'high';
    if (flip) { ctx.translate(slot.w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, sx, sy, cw, ch, 0, 0, slot.w, slot.h);
    return c;
  }

  // Ambil 1 frame segar dari kamera Orange Pi (tidak disimpan di server)
  function captureFrame(slot) {
    return fetch('api/snapshot?cam=' + state.camIndex + '&t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('snapshot');
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob), img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(coverCanvas(img, img.naturalWidth, img.naturalHeight, slot, state.mirror)); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
      });
    });
  }

  function countdown(sec) {
    var el = $('countdown');
    return (async function () {
      for (var n = sec; n >= 1; n--) {
        if (state.cancel) break;
        el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        beep(660, 0.12);
        await sleep(1000);
      }
      el.textContent = ''; el.classList.remove('tick');
    })();
  }

  function doFlash() {
    var f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    shutter();
  }

  async function runSequence() {
    var slots = state.tpl.slots;
    state.running = true; state.cancel = false; updateStartLabel();
    setControls(true);
    try {
      for (var i = state.photos.length; i < slots.length; i++) {
        setBoxRatio(slots[i]);
        renderThumbs(i);
        await sleep(350);
        await countdown(state.timer);
        if (state.cancel) break;
        doFlash();
        try { state.photos[i] = await captureFrame(slots[i]); }
        catch (e) { state.cancel = true; toast('Gagal mengambil foto dari kamera. Coba lagi.', 4000); break; }
        renderThumbs(i + 1 < slots.length ? i + 1 : i);
        await sleep(900);
      }
    } finally {
      state.running = false; setControls(false); updateStartLabel();
    }
    if (!state.cancel && state.photos.length === slots.length) finish();
    else { state.photos = []; renderThumbs(0); setBoxRatio(slots[0]); updateStartLabel(); }
  }

  function setControls(disabled) {
    ['btn-flip', 'btn-back'].forEach(function (id) { $(id).disabled = disabled; });
    var chips = document.querySelectorAll('.chip'); for (var i = 0; i < chips.length; i++) chips[i].disabled = disabled;
  }

  // ---------- gabung & preview ----------
  function compose() {
    var t = state.tpl, c = $('result');
    c.width = t.width; c.height = t.height;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, t.width, t.height);
    t.slots.forEach(function (s, i) {
      if (state.photos[i]) ctx.drawImage(applyEffect(state.photos[i], state.effect), s.x - 4, s.y - 4, s.w + 8, s.h + 8); // sedikit bleed di bawah frame
    });
    ctx.drawImage(state.tplImg, 0, 0, t.width, t.height);
  }

  function finish() {
    stopStream();
    var go = function () {
      compose();
      state.resultBlob = null;
      show('preview');
      confetti();
      $('btn-share').hidden = !(navigator.canShare && window.File);
    };
    if (state.tplImg) go();
    else { var iv = setInterval(function () { if (state.tplImg) { clearInterval(iv); go(); } }, 60); }
  }

  function filename() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return 'AQHI-Photobooth-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.jpg';
  }

  function getBlob() {
    if (state.resultBlob) return Promise.resolve(state.resultBlob);
    return new Promise(function (resolve) {
      $('result').toBlob(function (b) { state.resultBlob = b; resolve(b); }, 'image/jpeg', 0.95);
    });
  }

  function download() {
    getBlob().then(function (blob) {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename(); document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
      toast('Tersimpan! Cek galeri / folder Download 💙', 3500);
    });
  }

  function share() {
    getBlob().then(function (blob) {
      var file = new File([blob], filename(), { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Photobooth AQHI Lab' }).catch(function () {});
      }
      toast('Fitur bagikan tidak didukung, gunakan Download.');
    });
  }

  function retake() {
    state.photos = []; state.resultBlob = null;
    var c = $('result'); c.width = c.height = 1; // lepaskan memori
    startSession();
  }

  function backToTemplates() {
    stopStream(); state.photos = []; state.resultBlob = null; state.cancel = true;
    var c = $('result'); c.width = c.height = 1;
    show('templates');
  }

  // ---------- init ----------
  function init() {
    state.timer = parseInt(load('timer', '5'), 10) || 5;
    state.effect = load('fx', 'none');
    state.category = load('cat', 'all');
    if (effectById(state.effect).id !== state.effect) state.effect = 'none';
    buildFx();
    state.sound = load('sound', '1') === '1';
    $('btn-sound').setAttribute('aria-pressed', String(state.sound));

    var chips = $('timer-chips');
    [3, 5, 7, 10].forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'chip' + (s === state.timer ? ' on' : ''); b.textContent = s + 's';
      b.addEventListener('click', function () {
        state.timer = s; store('timer', s);
        Array.prototype.forEach.call(chips.children, function (c) { c.classList.toggle('on', c === b); });
      });
      chips.appendChild(b);
    });

    $('btn-start').addEventListener('click', function () {
      unlockAudio();
      if (state.running) { state.cancel = true; return; }
      if (!state.streamOk) return startCamera().then(function (ok) { if (ok) runSequence(); });
      runSequence();
    });
    $('btn-mirror').addEventListener('click', function () { state.mirror = !state.mirror; applyMirror(); });
    $('btn-flip').addEventListener('click', function () {
      state.camIndex = (state.camIndex + 1) % state.camCount;
      startCamera();
    });
    $('btn-sound').addEventListener('click', function () {
      state.sound = !state.sound; store('sound', state.sound ? '1' : '0');
      $('btn-sound').setAttribute('aria-pressed', String(state.sound));
    });
    $('btn-back').addEventListener('click', backToTemplates);
    $('btn-retake').addEventListener('click', retake);
    $('btn-download').addEventListener('click', download);
    $('btn-share').addEventListener('click', share);
    $('btn-newtpl').addEventListener('click', backToTemplates);
    window.addEventListener('pagehide', stopStream);

    fetch('api/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
      state.camCount = s.cameras.length;
      $('btn-flip').hidden = state.camCount < 2;
    }).catch(function () {});
    fetch('templates/templates.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { state.templates = cfg.templates; state.categories = cfg.categories || []; renderTemplates(); })
      .catch(function () { toast('Gagal memuat daftar template.', 6000); });
  }

  init();
})();

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
    facing: 'user',
    mirror: true,
    sound: true,
    timer: 5,
    stream: null,
    running: false,
    cancel: false,
    fallback: false,
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
    window.scrollTo(0, 0);
  }

  var actx = null;
  function beep(freq, dur, vol) {
    if (!state.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = freq; g.gain.value = vol || 0.12;
      o.connect(g); g.connect(actx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur);
    } catch (e) {}
  }

  // ---------- banner HTTPS ----------
  function checkSecure() {
    var hasCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    state.fallback = !hasCam;
    if (window.isSecureContext && hasCam) return;
    fetch('/api/info', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (info) {
      var b = $('banner');
      if (info.httpsPort && location.protocol === 'http:') {
        var url = 'https://' + location.hostname + ':' + info.httpsPort + '/';
        b.innerHTML = '📷 Kamera butuh koneksi aman. <a href="' + url + '">Buka versi HTTPS</a> (pilih "Lanjutkan" bila ada peringatan sertifikat).';
      } else {
        b.textContent = '📷 Browser memblokir kamera di alamat ini. Aktifkan HTTPS (lihat README) atau gunakan tombol kamera bawaan HP.';
      }
      b.hidden = false;
    }).catch(function () {});
  }

  // ---------- template ----------
  function formatName(f) { return f === 'strip' ? 'Photo Strip' : f === '4r' ? '4R Portrait' : 'Square 1:1'; }

  function renderTemplates() {
    var grid = $('template-grid');
    grid.innerHTML = '';
    state.templates.forEach(function (t) {
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
      grid.appendChild(card);
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
    var ratio = slot.w / slot.h;
    box.style.aspectRatio = slot.w + ' / ' + slot.h;
    box.style.width = 'min(100%, ' + (Math.round(ratio * 52 * 100) / 100) + 'vh)';
  }

  function stopStream() {
    if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
    $('video').srcObject = null;
  }

  function msg(text) {
    var m = $('cam-msg');
    if (!text) { m.hidden = true; return; }
    m.textContent = text; m.hidden = false;
  }

  function startCamera() {
    stopStream();
    if (state.fallback) { msg('Kamera langsung tidak tersedia di alamat ini. Tekan "Ambil Foto" untuk memakai kamera bawaan HP.'); return Promise.resolve(false); }
    msg('Menyalakan kamera… 📷');
    var constraints = { audio: false, video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      state.stream = stream;
      var v = $('video'); v.srcObject = stream;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      applyMirror();
      msg('');
      return true;
    }).catch(function (err) {
      var text = 'Kamera tidak bisa diakses. ';
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) text += 'Izinkan akses kamera pada browser (ikon gembok di address bar), lalu muat ulang halaman.';
      else if (err && err.name === 'NotFoundError') text += 'Tidak ada kamera ditemukan.';
      else text += 'Coba tutup aplikasi lain yang memakai kamera.';
      msg(text + ' Kamu juga bisa menekan "Ambil Foto" untuk memakai kamera bawaan HP.');
      state.fallback = true;
      updateStartLabel();
      return false;
    });
  }

  function applyMirror() {
    $('video').classList.toggle('mirror', state.mirror);
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
    if (state.fallback) b.textContent = '📸 Ambil Foto ke-' + (state.photos.length + 1);
    else b.textContent = '✨ Mulai Foto!';
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

  function captureFrame(slot) {
    var v = $('video');
    return coverCanvas(v, v.videoWidth, v.videoHeight, slot, state.mirror);
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
    beep(1100, 0.18, 0.18);
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
        state.photos[i] = captureFrame(slots[i]);
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

  // fallback: kamera bawaan HP lewat <input capture>
  function takeViaFile() {
    var input = $('file-fallback');
    input.value = '';
    input.onchange = function () {
      var f = input.files && input.files[0]; if (!f) return;
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () {
        var i = state.photos.length, slot = state.tpl.slots[i];
        state.photos[i] = coverCanvas(img, img.naturalWidth, img.naturalHeight, slot, false);
        URL.revokeObjectURL(url);
        input.value = '';
        if (state.photos.length === state.tpl.slots.length) finish();
        else { setBoxRatio(state.tpl.slots[state.photos.length]); renderThumbs(); updateStartLabel(); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast('Gambar tidak bisa dibaca, coba lagi.'); };
      img.src = url;
    };
    input.click();
  }

  // ---------- gabung & preview ----------
  function compose() {
    var t = state.tpl, c = $('result');
    c.width = t.width; c.height = t.height;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, t.width, t.height);
    t.slots.forEach(function (s, i) {
      if (state.photos[i]) ctx.drawImage(state.photos[i], s.x - 4, s.y - 4, s.w + 8, s.h + 8); // sedikit bleed di bawah frame
    });
    ctx.drawImage(state.tplImg, 0, 0, t.width, t.height);
  }

  function finish() {
    stopStream();
    var go = function () {
      compose();
      state.resultBlob = null;
      show('preview');
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
      if (state.running) { state.cancel = true; return; }
      if (state.fallback || !state.stream) {
        if (state.fallback) return takeViaFile();
        return startCamera().then(function (ok) { if (ok) runSequence(); });
      }
      runSequence();
    });
    $('btn-mirror').addEventListener('click', function () { state.mirror = !state.mirror; applyMirror(); });
    $('btn-flip').addEventListener('click', function () {
      state.facing = state.facing === 'user' ? 'environment' : 'user';
      state.mirror = state.facing === 'user';
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

    checkSecure();
    fetch('templates/templates.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { state.templates = cfg.templates; renderTemplates(); })
      .catch(function () { toast('Gagal memuat daftar template.', 6000); });
  }

  init();
})();

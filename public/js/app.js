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
    state.streamOk = false;
    var f = $('feed');
    f.removeAttribute('src'); // menutup koneksi -> server mematikan kamera saat idle
  }

  function msg(text) {
    var m = $('cam-msg');
    if (!text) { m.hidden = true; return; }
    m.textContent = text; m.hidden = false;
  }

  // Preview langsung dari kamera yang terpasang di Orange Pi (MJPEG)
  function startCamera() {
    stopStream();
    msg('Menyalakan kamera… 📷');
    var f = $('feed');
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (ok, text) {
        if (done) return; done = true; clearTimeout(timer);
        f.onload = f.onerror = null;
        state.streamOk = ok;
        if (ok) { applyMirror(); msg(''); }
        else {
          stopStream();
          msg(text || 'Kamera di Orange Pi tidak terdeteksi. Pastikan kamera USB terpasang, lalu tekan tombol Mulai untuk mencoba lagi.');
        }
        resolve(ok);
      };
      var timer = setTimeout(function () { finish(false); }, 10000);
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
      .then(function (cfg) { state.templates = cfg.templates; renderTemplates(); })
      .catch(function () { toast('Gagal memuat daftar template.', 6000); });
  }

  init();
})();

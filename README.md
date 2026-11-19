# 📸 Photobooth AQHI Lab

Photobooth berbasis web untuk Laboratorium **AQHI (Air Quality Health Impact)** — edukasi dan riset dampak kualitas udara terhadap kesehatan. Berjalan **offline** di **Orange Pi** yang berperan sebagai **Wi-Fi Hotspot**. **Kamera (USB webcam) terpasang di Orange Pi**; pengunjung cukup konek ke Wi-Fi, membuka browser HP/tablet, lalu melihat preview kamera Orange Pi dan menekan tombol foto.

- **32 template lucu & warna-warni dalam 6 kategori** (Sains & Lab, Kesehatan, Alam & Bumi, Cuaca & Langit, Skala AQHI, Pesta & Ceria) dengan karakter kartun ilmuwan berjas lab, peneliti, dokter, robot sensor, awan smog, bumi, burung, dll. — format Photo Strip `600×1800`, 4R `1200×1800`, Square `1200×1200`; 3–5 slot foto.
- **Efek foto** (Normal, Hitam Putih, Sepia, Cerah, Hangat, Sejuk, Pink, Biru Sains, Retro, Pop Art, Glow): live preview di kamera dan bisa diganti lagi di halaman hasil. Efek yang butuh fitur browser tertentu (Glow) otomatis disembunyikan bila tidak didukung.
- **Zero server storage**: server hanya meneruskan frame kamera dari memori (preview MJPEG + snapshot) — tidak ada yang ditulis ke disk. Penggabungan template (HTML5 Canvas) dan unduhan terjadi di browser pengguna. Server hanya menerima GET/HEAD (tidak ada upload).
- Timer hitung mundur (3/5/7/10 dtk), mirror, ganti kamera (bila Orange Pi punya >1 kamera), preview, **Ulangi Foto** & **Download Hasil**.
- Server Node.js tanpa paket npm (butuh `ffmpeg`). Port **8080** — **bukan 5000**. Tidak perlu HTTPS karena kamera dibuka di server, bukan di HP.

```
photoboth-aqhi/
├── server.js                  # server statis (tanpa npm install)
├── public/                    # frontend (mobile-first)
│   ├── index.html · css/ · js/app.js
│   └── templates/             # 32 PNG + templates.json (koordinat slot)
├── tools/generate_templates.py# pembuat template bawaan (opsional)
├── scripts/                   # install-orangepi.sh · setup-hotspot.sh (opsional)
└── deploy/aqhi-photobooth.service
```

## 1. Coba cepat di komputer (tanpa kamera)

```bash
git clone https://github.com/efendiyhy/photoboth-aqhi.git
cd photoboth-aqhi
CAMERA_DEVICES=test node server.js   # pola uji ffmpeg; buka http://localhost:8080
```

## 2. Instalasi di Orange Pi (step-by-step)

Syarat: Orange Pi (Armbian/Debian/Ubuntu) dengan **webcam USB** terpasang. Sambungkan internet **hanya untuk instalasi awal**. Hotspot yang sudah ada **tidak diubah** — lewati `setup-hotspot.sh` bila hotspot sudah aktif.

### a. Clone
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/efendiyhy/photoboth-aqhi.git
cd photoboth-aqhi
```

### b. Cek kamera
```bash
sudo apt install -y ffmpeg v4l-utils
ls /dev/video*                         # biasanya /dev/video0 (kadang video0 + video1 untuk satu kamera)
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video0 --list-formats-ext | head -30   # cari MJPG dan resolusinya
```

### c. Pasang & aktifkan layanan otomatis (systemd)
```bash
sudo bash scripts/install-orangepi.sh
```
Skrip ini memasang Node.js & ffmpeg bila perlu, menambah user ke grup `video`, menulis `/etc/default/aqhi-photobooth`, membuat `/etc/systemd/system/aqhi-photobooth.service`, lalu `enable --now` (otomatis hidup saat boot).

```bash
systemctl status aqhi-photobooth       # harus: active (running)
curl http://localhost:8080/healthz     # ok
curl http://localhost:8080/api/snapshot -o tes.jpg   # ambil 1 frame uji dari kamera
journalctl -u aqhi-photobooth -f       # log
```

**Pengaturan** — edit `/etc/default/aqhi-photobooth`, lalu `sudo systemctl restart aqhi-photobooth`:

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `8080` | Jangan `5000`. `80` juga bisa. |
| `CAMERA_DEVICES` | `/dev/video0` | Beberapa kamera dipisah koma: `/dev/video0,/dev/video2` (muncul tombol *Ganti Kamera*). Bisa juga URL stream program lain yang sudah memegang kamera, mis. `http://127.0.0.1:5000/video/raw` (lihat di bawah). |
| `CAMERA_SIZE` | `1280x720` | Resolusi yang didukung kamera (mis. `1920x1080`). |
| `CAMERA_FPS` | `15` | Naikkan bila kamera & CPU kuat. |
| `CAMERA_INPUT` | `mjpeg` | Isi `auto` jika kamera tidak punya format MJPG (CPU lebih tinggi). |

**Kamera sudah dipakai program lain?** Kamera USB hanya bisa dibuka satu program. Jika program lain (mis. di port 5000) sudah memegang kamera dan menyediakan stream video, arahkan photobooth ke stream itu, bukan ke `/dev/video0`:
```bash
sudo sed -i 's|^CAMERA_DEVICES=.*|CAMERA_DEVICES=http://127.0.0.1:5000/video/raw|' /etc/default/aqhi-photobooth
sudo systemctl restart aqhi-photobooth
```
`CAMERA_SIZE` tidak berlaku untuk sumber URL (mengikuti ukuran stream aslinya).

### d. Hotspot
Jika Orange Pi **sudah** menjadi hotspot, tidak perlu apa-apa. Cek IP-nya: `ip -4 addr show`. Jika belum: `sudo bash scripts/setup-hotspot.sh "NAMA" "SANDI"` (memakai NetworkManager, IP `10.42.0.1`).

### e. Pemakaian oleh pengunjung
1. HP konek ke hotspot Orange Pi.
2. Buka **`http://IP-ORANGE-PI:8080`** (mis. `http://10.42.0.1:8080`).
3. Pilih template → tekan **Mulai Foto** → pose di depan kamera Orange Pi (preview tampil di HP).
4. Preview hasil → **Download Hasil** (tersimpan di HP) atau **Ulangi Foto**.

> Tip: cetak QR code berisi alamat di atas dan tempel di booth. Tempatkan kamera setinggi wajah dan hadapkan ke area berdiri; aktifkan **Mirror** agar preview seperti cermin.

### f. Memperbarui nanti
```bash
cd photoboth-aqhi && git pull && sudo bash scripts/install-orangepi.sh   # aman diulang, pengaturan lama tidak ditimpa
```

## 3. Troubleshooting kamera

| Gejala | Solusi |
|---|---|
| Preview "Kamera tidak terdeteksi" | `ls /dev/video*`; cabut-colok USB; cek `curl localhost:8080/api/status` (kolom `error`). |
| `Permission denied` di log | `sudo usermod -aG video <user>` lalu `sudo systemctl restart aqhi-photobooth` (skrip install sudah melakukannya). |
| `ffmpeg belum terpasang` | `sudo apt install ffmpeg`. |
| Gambar patah-patah | Turunkan `CAMERA_SIZE` (mis. `640x480`) / `CAMERA_FPS`, atau pakai kamera yang mendukung MJPG. |
| Kamera tidak punya MJPG | Set `CAMERA_INPUT=auto`. |
| Beda nomor `/dev/videoN` | Cek `v4l2-ctl --list-devices`, ubah `CAMERA_DEVICES`. |
| Kamera dipakai program lain | `sudo fuser -v /dev/video0` lalu hentikan prosesnya. |

Kamera hanya menyala saat ada pengunjung yang membuka sesi foto dan mati otomatis ±8 detik setelah idle.

## 4. Mengganti template dengan desain Figma

Template = **satu PNG berukuran penuh** dengan area foto **transparan** + entri di `public/templates/templates.json`. Aplikasi menaruh foto di bawah PNG, jadi tepi bingkai/stiker yang menimpa foto otomatis terlihat rapi.

**Ukuran ekspor (1x, tanpa skala lain):**

| Format | Ukuran frame Figma | Slot |
|---|---|---|
| Photo Strip vertikal | `600 × 1800 px` | 3–4 |
| 4R Portrait | `1200 × 1800 px` | 3–5 |
| Square 1:1 | `1200 × 1200 px` | 3–5 |

**Langkah:**
1. Buat Frame dengan ukuran di atas. Gambar bingkai, judul "AQHI Lab", ikon, dan skala AQHI 1–10+.
2. Untuk setiap slot foto buat *rectangle* (boleh rounded) — catat **X, Y, W, H** dari panel Design (relatif terhadap frame) dan corner radius.
3. **Lubangi** slot: pilih rectangle slot + background di belakangnya → *Subtract selection* (Boolean), atau sembunyikan layer yang menutupi slot. Pastikan area slot benar-benar transparan.
4. Export frame: **PNG, 1x**. Beri nama mis. `awan-ceria.png` → simpan ke `public/templates/`.
5. Edit `public/templates/templates.json`:
```json
{
  "id": "awan-ceria", "name": "Awan Ceria", "file": "awan-ceria.png",
  "category": "cuaca", "width": 600, "height": 1800, "format": "strip", "color": "#4cc3f5",
  "slots": [
    { "x": 40, "y": 300, "w": 520, "h": 400, "radius": 30 },
    { "x": 40, "y": 750, "w": 520, "h": 400, "radius": 30 }
  ]
}
```
   `category`: id dari daftar `categories` di bagian atas `templates.json` (`sains`, `kesehatan`, `alam`, `cuaca`, `aqhi`, `pesta`; kategori baru cukup ditambahkan ke daftar itu). Template tanpa kategori masuk grup *Lainnya*.
   `format`: `strip` | `4r` | `square`. Jumlah `slots` = jumlah jepretan. Urutan slot = urutan foto. Urutan template di galeri = urutan di array.
6. Muat ulang halaman (tidak perlu restart server).

Template bawaan (32 buah) dibuat dengan `python3 tools/generate_templates.py` (butuh `pip install pillow`) — bisa diubah palet/ikonnya lalu dijalankan ulang untuk membuat ulang 32 PNG + JSON.

**Palet tema:** biru langit `#8fd8ff`, hijau toska `#3fd6c4`, putih `#ffffff`, skala AQHI `#01cbff #0099cb #016797 #fffe03 #ffcb00 #ff9835 #fd6866 #fe0002 #cc0001 #9a0100 #640100` (1–10+).

## 5. Privasi
- Tidak ada foto yang ditulis ke disk Orange Pi: server hanya menyimpan 1 frame terbaru di memori dan menolak semua metode selain GET/HEAD.
- Penggabungan template terjadi di browser; foto hilang dari memori saat "Ulangi Foto", "Ganti Template", atau tab ditutup.
- Hasil akhir berupa JPEG 95 % (`1200×1800` / `600×1800` / `1200×1200`).
- Port bentrok: `sudo ss -ltnp | grep :8080` lalu ubah `PORT`.

Lisensi: MIT.

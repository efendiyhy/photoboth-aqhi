# 📸 Photobooth AQHI Lab

Photobooth berbasis web untuk Laboratorium **AQHI (Air Quality Health Impact)** — edukasi dan riset dampak kualitas udara terhadap kesehatan. Berjalan **offline** di **Orange Pi** yang berperan sebagai **Wi-Fi Hotspot**; pengunjung cukup konek ke Wi-Fi lalu membuka browser HP/tablet.

- **10 template lucu** (awan berwajah, paru-paru, labu lab, pohon, payung, skala AQHI 1–10+) — format Photo Strip `600×1800`, 4R `1200×1800`, Square `1200×1200`; 3–5 slot foto.
- **Zero server storage**: kamera (WebRTC), penggabungan (HTML5 Canvas), dan unduhan 100 % di browser. Server hanya melayani file statis (GET/HEAD) — tidak ada endpoint upload.
- Timer hitung mundur (3/5/7/10 dtk), mirror, ganti kamera depan/belakang, preview, **Ulangi Foto** & **Download Hasil**.
- Server Node.js tanpa dependensi. Port **8080** (HTTP) dan **8443** (HTTPS) — **bukan 5000**.

```
photoboth-aqhi/
├── server.js                  # server statis (tanpa npm install)
├── public/                    # frontend (mobile-first)
│   ├── index.html · css/ · js/app.js
│   └── templates/             # 10 PNG + templates.json (koordinat slot)
├── tools/generate_templates.py# pembuat template bawaan (opsional)
├── scripts/                   # install-orangepi.sh · setup-hotspot.sh · gen-cert.sh
└── deploy/aqhi-photobooth.service
```

## 1. Coba cepat di komputer

```bash
git clone https://github.com/efendiyhy/photoboth-aqhi.git
cd photoboth-aqhi
node server.js            # http://localhost:8080  (localhost boleh memakai kamera)
```

## 2. Instalasi di Orange Pi (step-by-step)

Perangkat: Orange Pi dengan Armbian/Debian/Ubuntu, Wi-Fi yang mendukung mode AP (atau dongle USB Wi-Fi). Sambungkan ke internet **hanya untuk instalasi awal**.

### a. Clone & jalankan
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/efendiyhy/photoboth-aqhi.git
cd photoboth-aqhi
node -v                   # butuh Node >= 14 (jika belum ada, skrip di langkah b memasangnya)
PORT=8080 node server.js  # tes manual, Ctrl+C untuk berhenti
```

### b. Aktifkan layanan otomatis (systemd) — cara cepat
```bash
sudo bash scripts/install-orangepi.sh
```
Skrip ini: memasang Node bila perlu, membuat sertifikat HTTPS, menulis `/etc/systemd/system/aqhi-photobooth.service`, lalu `enable --now`.

Perintah berguna:
```bash
systemctl status aqhi-photobooth
journalctl -u aqhi-photobooth -f
sudo systemctl restart aqhi-photobooth
```
**Mengganti port:** edit `/etc/default/aqhi-photobooth` (`PORT=8000`, atau `PORT=80`), lalu `sudo systemctl restart aqhi-photobooth`. Server menolak port 5000.

<details><summary>Cara manual (tanpa skrip)</summary>

```bash
bash scripts/gen-cert.sh
sed -e "s|__USER__|$USER|" -e "s|__APP_DIR__|$PWD|" -e "s|__NODE__|$(command -v node)|" \
  deploy/aqhi-photobooth.service | sudo tee /etc/systemd/system/aqhi-photobooth.service
sudo systemctl daemon-reload && sudo systemctl enable --now aqhi-photobooth
```
</details>

### c. Aktifkan Wi-Fi Hotspot
```bash
sudo bash scripts/setup-hotspot.sh "AQHI-Photobooth" "aqhi12345"
```
Memakai NetworkManager (`nmcli`): SSID & password sesuai argumen, IP Orange Pi **10.42.0.1**, DHCP otomatis, auto-start saat boot, dan nama lokal `photobooth.lab`. Ganti password default sebelum dipakai umum.

Cek: `nmcli con show --active` · `nmcli -f GENERAL.STATE con show AQHI-Hotspot`.

<details><summary>Tidak ada NetworkManager? Hotspot manual (hostapd + dnsmasq)</summary>

```bash
sudo apt install -y hostapd dnsmasq
sudo ip addr add 10.42.0.1/24 dev wlan0
# /etc/hostapd/hostapd.conf
#   interface=wlan0  ssid=AQHI-Photobooth  hw_mode=g  channel=6
#   wpa=2  wpa_passphrase=aqhi12345  wpa_key_mgmt=WPA-PSK  rsn_pairwise=CCMP
# /etc/dnsmasq.d/aqhi.conf
#   interface=wlan0
#   dhcp-range=10.42.0.10,10.42.0.200,12h
#   address=/photobooth.lab/10.42.0.1
sudo systemctl unmask hostapd && sudo systemctl enable --now hostapd dnsmasq
```
Buat IP statis permanen lewat `/etc/network/interfaces` atau netplan sesuai OS-mu.
</details>

### d. Pemakaian oleh pengunjung
1. HP konek ke Wi-Fi **AQHI-Photobooth**.
2. Buka **`https://10.42.0.1:8443`** (atau `https://photobooth.lab:8443`). Halaman HTTP `http://10.42.0.1:8080` juga bisa dibuka dan otomatis menampilkan tautan ke versi HTTPS.
3. Muncul peringatan sertifikat → **Lanjutan / Advanced → Lanjutkan ke 10.42.0.1** (sekali per perangkat).
4. Izinkan kamera, pilih template, mulai foto.

> Tip: cetak QR code berisi `https://10.42.0.1:8443` dan tempel di booth. Jika hotspot tidak punya internet, sebagian HP menampilkan "tidak ada internet" — pilih **tetap terhubung**.

## 3. Catatan izin kamera di browser HP

Browser hanya mengizinkan kamera pada **konteks aman**: `https://` atau `localhost`. Karena hotspot lokal memakai alamat IP, akses `http://10.42.0.1:8080` biasanya **diblokir** — karena itu aplikasi menyediakan HTTPS (port 8443) dengan sertifikat self-signed.

| Masalah | Solusi |
|---|---|
| Kamera tidak menyala di `http://` | Pakai `https://10.42.0.1:8443` dan terima peringatan sertifikat. |
| Izin kamera ditolak | Chrome Android: ikon gembok → *Izin* → Kamera → Izinkan, lalu muat ulang. Safari iOS: *aA* → *Pengaturan Situs Web* → Kamera → Izinkan. |
| Sertifikat ditolak total | Jalankan `bash scripts/gen-cert.sh <IP> <host>` ulang sesuai alamat yang dipakai, lalu `sudo systemctl restart aqhi-photobooth`. |
| Kamera tetap tidak tersedia | Aplikasi otomatis beralih ke mode cadangan: tombol **Ambil Foto** membuka kamera bawaan HP untuk tiap slot. |
| Unduhan tidak masuk galeri (iOS) | Pakai tombol **Bagikan / Simpan ke Galeri** → *Simpan Gambar*. Android: file ada di *Download* dan muncul di galeri. |

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
  "width": 600, "height": 1800, "format": "strip", "color": "#4cc3f5",
  "slots": [
    { "x": 40, "y": 300, "w": 520, "h": 400, "radius": 30 },
    { "x": 40, "y": 750, "w": 520, "h": 400, "radius": 30 }
  ]
}
```
   `format`: `strip` | `4r` | `square`. Jumlah `slots` = jumlah jepretan. Urutan slot = urutan foto. Urutan template di galeri = urutan di array.
6. Muat ulang halaman (tidak perlu restart server).

Template bawaan dibuat dengan `python3 tools/generate_templates.py` (butuh `pip install pillow`) — bisa diubah palet/ikonnya lalu dijalankan ulang untuk membuat ulang 10 PNG + JSON.

**Palet tema:** biru langit `#8fd8ff`, hijau toska `#3fd6c4`, putih `#ffffff`, skala AQHI `#01cbff #0099cb #016797 #fffe03 #ffcb00 #ff9835 #fd6866 #fe0002 #cc0001 #9a0100 #640100` (1–10+).

## 5. Privasi
- Tidak ada penyimpanan foto di server/Orange Pi; server menolak semua metode selain GET/HEAD.
- Foto hanya berada di memori browser dan hilang saat "Ulangi Foto", "Ganti Template", atau tab ditutup.
- Hasil akhir berupa JPEG 95 % (`1200×1800` / `600×1800` / `1200×1200`).

## 6. Troubleshooting
- **Port bentrok**: `sudo ss -ltnp | grep -E ':8080|:8443'` lalu ubah di `/etc/default/aqhi-photobooth`.
- **Hotspot tidak muncul**: `nmcli device status`, pastikan adapter mendukung AP (`iw list | grep -A8 "interface modes"`).
- **Halaman tidak terbuka dari HP**: pastikan HP tidak memakai VPN/Private DNS "ketat", dan IP Orange Pi memang `10.42.0.1` (`ip addr show wlan0`).

Lisensi: MIT.

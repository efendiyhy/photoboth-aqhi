#!/usr/bin/env bash
# Instalasi otomatis di Orange Pi (Debian/Ubuntu/Armbian).
# Jalankan dari folder repo:  sudo bash scripts/install-orangepi.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Jalankan dengan sudo: sudo bash scripts/install-orangepi.sh"; exit 1; fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
[ "$RUN_USER" = "root" ] && RUN_USER="$(stat -c %U "$APP_DIR")"

echo "==> Folder aplikasi : $APP_DIR"
echo "==> Dijalankan oleh : $RUN_USER"

# 1. Node.js (>= 14 direkomendasikan)
need_node=1
if command -v node >/dev/null; then
  major="$(node -v | sed 's/^v//; s/\..*//')"
  [ "$major" -ge 14 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo "==> Memasang Node.js (butuh internet sementara)"
  apt-get update
  apt-get install -y curl ca-certificates openssl
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
  apt-get install -y nodejs
fi
command -v openssl >/dev/null || apt-get install -y openssl
NODE_BIN="$(command -v node)"
echo "==> Node: $($NODE_BIN -v)"

# 2. ffmpeg (membaca kamera USB di Orange Pi) + izin akses kamera
if ! command -v ffmpeg >/dev/null; then
  echo "==> Memasang ffmpeg"
  apt-get update
  apt-get install -y ffmpeg
fi
usermod -aG video "$RUN_USER" || true

# 3. Konfigurasi (port & kamera). Nilai yang sudah ada TIDAK ditimpa.
CFG=/etc/default/aqhi-photobooth
touch "$CFG"
add_cfg() { grep -q "^$1=" "$CFG" || echo "$1=$2" >> "$CFG"; }
add_cfg PORT 8080
add_cfg CAMERA_DEVICES /dev/video0
add_cfg CAMERA_SIZE 1280x720
add_cfg CAMERA_FPS 15
sed -i '/^HTTPS_PORT=/d' "$CFG"

# 4. Service systemd
sed -e "s|__USER__|$RUN_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE_BIN|g" \
  "$APP_DIR/deploy/aqhi-photobooth.service" > /etc/systemd/system/aqhi-photobooth.service
systemctl daemon-reload
systemctl enable --now aqhi-photobooth.service
sleep 1
systemctl --no-pager --lines=5 status aqhi-photobooth.service || true

echo
echo "Selesai! Photobooth aktif di port 8080."
echo "Cek kamera : ls /dev/video*    |    curl -s localhost:8080/api/status"
echo "Buka dari HP yang tersambung ke hotspot:  http://<IP-ORANGE-PI>:8080"

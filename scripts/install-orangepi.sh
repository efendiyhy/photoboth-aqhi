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

# 2. Sertifikat HTTPS (untuk akses kamera dari HP)
if [ ! -f "$APP_DIR/certs/server.crt" ]; then
  echo "==> Membuat sertifikat HTTPS self-signed"
  sudo -u "$RUN_USER" bash "$APP_DIR/scripts/gen-cert.sh"
fi

# 3. Konfigurasi port (default 8080 / 8443)
if [ ! -f /etc/default/aqhi-photobooth ]; then
  cat > /etc/default/aqhi-photobooth <<CFG
# Port aplikasi. JANGAN pakai 5000 (sudah dipakai layanan lain).
PORT=8080
HTTPS_PORT=8443
CFG
fi

# 4. Service systemd
sed -e "s|__USER__|$RUN_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE_BIN|g" \
  "$APP_DIR/deploy/aqhi-photobooth.service" > /etc/systemd/system/aqhi-photobooth.service
systemctl daemon-reload
systemctl enable --now aqhi-photobooth.service
sleep 1
systemctl --no-pager --lines=5 status aqhi-photobooth.service || true

echo
echo "Selesai! Photobooth aktif di port 8080 (HTTP) dan 8443 (HTTPS)."
echo "Langkah berikut (opsional) - aktifkan hotspot:"
echo "  sudo bash $APP_DIR/scripts/setup-hotspot.sh \"AQHI-Photobooth\" \"aqhi12345\""

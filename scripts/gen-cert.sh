#!/usr/bin/env bash
# Membuat sertifikat HTTPS self-signed (agar kamera HP bisa dipakai lewat IP hotspot).
# Pemakaian: bash scripts/gen-cert.sh [IP_HOTSPOT] [NAMA_HOST]
set -euo pipefail
cd "$(dirname "$0")/.."
IP="${1:-10.42.0.1}"
HOST="${2:-photobooth.lab}"
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=${HOST}/O=AQHI Lab Photobooth" \
  -addext "subjectAltName=DNS:${HOST},DNS:localhost,IP:${IP},IP:127.0.0.1"
chmod 600 certs/server.key
echo "Sertifikat dibuat di certs/ (berlaku 825 hari) untuk ${HOST} / ${IP}"

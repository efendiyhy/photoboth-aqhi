#!/usr/bin/env bash
# Mengaktifkan Wi-Fi Hotspot (Access Point) di Orange Pi memakai NetworkManager.
# Pemakaian: sudo bash scripts/setup-hotspot.sh [SSID] [PASSWORD] [INTERFACE]
#   contoh : sudo bash scripts/setup-hotspot.sh "AQHI-Photobooth" "aqhi12345"
# Setelah aktif: IP Orange Pi = 10.42.0.1, nama lokal = http://photobooth.lab:8080
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Jalankan dengan sudo."; exit 1; fi
command -v nmcli >/dev/null || { echo "nmcli (NetworkManager) tidak ditemukan. Lihat README bagian 'Hotspot manual (hostapd)'."; exit 1; }

SSID="${1:-AQHI-Photobooth}"
PASS="${2:-aqhi12345}"
IFACE="${3:-$(nmcli -t -f DEVICE,TYPE device | awk -F: '$2=="wifi"{print $1; exit}')}"
CON="AQHI-Hotspot"
IP="10.42.0.1/24"

[ -n "$IFACE" ] || { echo "Interface Wi-Fi tidak ditemukan."; exit 1; }
[ "${#PASS}" -ge 8 ] || { echo "Password minimal 8 karakter."; exit 1; }

if command -v iw >/dev/null && ! iw list 2>/dev/null | grep -A12 "Supported interface modes" | grep -q "\* AP"; then
  echo "PERINGATAN: adapter Wi-Fi ini tampaknya tidak mendukung mode AP. Pertimbangkan dongle USB Wi-Fi yang mendukung AP."
fi

nmcli radio wifi on || true
nmcli con delete "$CON" >/dev/null 2>&1 || true
nmcli con add type wifi ifname "$IFACE" con-name "$CON" autoconnect yes ssid "$SSID"
nmcli con modify "$CON" \
  802-11-wireless.mode ap 802-11-wireless.band bg \
  ipv4.method shared ipv4.addresses "$IP" \
  ipv6.method ignore \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS" \
  connection.autoconnect-priority 100

# Nama lokal http://photobooth.lab (dnsmasq bawaan NetworkManager mode 'shared')
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
echo "address=/photobooth.lab/10.42.0.1" > /etc/NetworkManager/dnsmasq-shared.d/aqhi-photobooth.conf

nmcli con up "$CON"
echo
echo "Hotspot aktif:  SSID=$SSID  PASS=$PASS  IFACE=$IFACE"
echo "Buka dari HP :  http://10.42.0.1:8080   atau   https://10.42.0.1:8443 (kamera)"

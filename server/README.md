# VPS Deployment Guide - YTMusic Downloader

Proyek ini telah dikonsolidasi agar siap dijalankan di VPS dengan struktur minimalis.

## 📂 Struktur Direktori
Pastikan di VPS Anda memiliki struktur seperti ini:
- `dist/` (Folder hasil build frontend)
- `index.js` (Server backend Express)
- `package.json` (File dependensi)
- `.env` (Jika ada API Key atau port kustom)

## 🚀 Cara Menjalankan di VPS

### 1. Persiapan
Upload folder `vps-deploy` ke VPS Anda (melalui FTP/SCP atau Git).

### 2. Instalasi Dependensi
Jalankan perintah berikut di dalam folder proyek di VPS:
```bash
npm install --omit=dev
```
*Catatan: Jika instalasi `youtube-dl-exec` gagal karena masalah Python, jalankan:*
```bash
YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install --omit=dev
```

### 3. Jalankan Server
Gunakan **PM2** (direkomendasikan) agar server tetap jalan di background:
```bash
# Install PM2 jika belum ada
npm install -g pm2

# Jalankan aplikasi
pm2 start index.js --name "ytmusic-downloader"

# Agar otomatis jalan saat VPS restart
pm2 save
pm2 startup
```

### 4. Akses Aplikasi
Aplikasi akan berjalan di port `5200` (atau port di `.env`). Anda bisa mengaksesnya langsung via IP VPS atau menggunakan Nginx sebagai Reverse Proxy.

---

## 🛠️ Ringkasan Teknis
- **Backend:** Express.js (Node.js)
- **Frontend:** React + Tailwind (Pre-built di folder `dist`)
- **Fitur:** ID3 Tagging otomatis (Cover art, Title, Artist) tertanam langsung di MP3.
- **API:** Menggunakan API eksternal kualitas 320kbps.

Dibuat oleh Gemini CLI.
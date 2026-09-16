# 🚀 Deployment Server Guide - Music IDL

Dokumen ini menjelaskan cara menjalankan backend server **Music IDL** di VPS atau Server Lokal.

## ⚙️ Prasyarat Server
1. **Node.js 18+**
2. **Python 3.10+** dengan dependensi engine:
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r engine/requirements.txt
   ```
3. **FFmpeg** terinstall dan terdaftar di `PATH` sistem.

Artwork album dicocokkan melalui iTunes Search API. Storefront default adalah
Indonesia dan dapat diubah lewat environment variable `ITUNES_COUNTRY`.

---

## 📂 Struktur Direktori Server
- `index.js` (Server backend Express)
- `engine/` (Python script pengunduh & metadata)
- `dist/` (Folder statistik/pre-built frontend React)
- `package.json`

---

## 🚀 Langkah Jalankan di Server / VPS

### 1. Instalasi Dependensi Node.js
```bash
npm install --omit=dev
cp .env.example .env
```

Atur minimal `PYTHON_BIN=.venv/bin/python` dan `YT_DLP_BIN=.venv/bin/yt-dlp`. Proxy SOCKS5 tidak wajib; isi `DOWNLOAD_PROXY` hanya bila diperlukan.

### 2. Jalankan Server dengan PM2
```bash
npm install -g pm2
pm2 start index.js --name "music-idl"
pm2 save
```

Server akan aktif di port `5200`.

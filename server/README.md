# 🚀 Deployment Server Guide - Music IDL

Dokumen ini menjelaskan cara menjalankan backend server **Music IDL** di VPS atau Server Lokal.

## ⚙️ Prasyarat Server
1. **Node.js 18+**
2. **Python 3.8+** dengan `yt-dlp`:
   ```bash
   pip install yt-dlp
   ```
3. **FFmpeg** terinstall dan terdaftar di `PATH` sistem.

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
```

### 2. Jalankan Server dengan PM2
```bash
npm install -g pm2
pm2 start index.js --name "music-idl"
pm2 save
```

Server akan aktif di port `5200`.
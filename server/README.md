# 🚀 Deployment Server Guide - Music IDL

Dokumen ini menjelaskan cara menjalankan backend server **Music IDL** di VPS atau Server Lokal.

## ⚙️ Prasyarat Server
1. **Node.js** `^20.19.0` atau `>=22.12.0`
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

Atur minimal `PYTHON_BIN=.venv/bin/python`, `YT_DLP_BIN=.venv/bin/yt-dlp`, `FFMPEG_BIN=ffmpeg`, dan `DENO_BIN=deno`. Proxy SOCKS5 tidak wajib; isi `DOWNLOAD_PROXY` hanya bila diperlukan.

### 2. Jalankan Server dengan PM2
```bash
npm install -g pm2
pm2 start index.js --name "music-idl"
pm2 save
```

Server akan aktif di port `5200`.

Gunakan satu instance PM2. Job dan antrean disimpan di memori proses, sehingga mode cluster atau beberapa VPS memerlukan antrean bersama yang belum menjadi bagian dari aplikasi ini.

## Endpoint operasional

- `GET /api/health` memeriksa binary wajib, akses tulis output, serta jumlah job aktif/menunggu.
- `POST /api/jobs` membuat job MP3 (`128`, `192`, `320`) atau `original` untuk Fast Mode.
- `GET /api/jobs/:id` membaca progres.
- `DELETE /api/jobs/:id` membatalkan job.
- `POST /api/jobs/:id/retry` mencoba ulang job gagal/dibatalkan.
- `GET /api/jobs/:id/file` mengirim file yang sudah selesai dan membersihkan direktori job.

Set `HEALTHCHECK_BINARIES=false` hanya pada integration test. Jangan mematikannya di production. File terminal dibersihkan setelah `JOB_TTL_MS`; default satu jam.

## Test

```bash
npm test
npm run test:engine
```

`npm test` menjalankan integration test dengan `test/fixtures/fake-engine.js`; tes tersebut tidak memerlukan koneksi internet. Untuk deployment, tetap lakukan satu unduhan pendek secara manual guna memverifikasi akses YouTube, yt-dlp, Deno, FFmpeg, proxy opsional, artwork, dan header download pada browser.

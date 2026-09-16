# 🎵 Music Downloader (Music-IDL)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind_CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwindcss&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![PM2](https://img.shields.io/badge/PM2-2B826B?style=flat&logo=pm2&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-00A2C9?style=flat&logo=caddy&logoColor=white)

Aplikasi web untuk mencari dan mengunduh audio dari video YouTube sebagai MP3 128/192/320 kbps atau memakai Fast Mode tanpa encoding ulang. Unduhan berjalan sebagai job dengan progres nyata, cancel, retry, dan metadata hasil aktual. Kualitas hasil tetap bergantung pada kualitas audio sumber.

---

## 📂 Struktur Proyek

* `/client`: Frontend (React + Vite + TypeScript + Tailwind CSS)
* `/server`: Backend Server (Node.js + Express)
* `/server/engine`: engine pengunduh musik (Python `yt-dlp` dan `ffmpeg`; SOCKS5 bersifat opsional)

---

## ⚙️ Prasyarat (Requirements)

Sebelum menjalankan aplikasi, pastikan sistem kamu sudah menginstal:

1. **Node.js** (`^20.19.0` atau `>=22.12.0`) & **npm**
2. **Python 3.10+** dengan dependensi dari `server/engine/requirements.txt`
3. **FFmpeg** (untuk konversi format ke MP3)
4. **Deno** bila extractor YouTube membutuhkannya
5. **Cloudflare WARP/SOCKS5** hanya bila koneksi server memang memerlukannya

---

## 🚀 Cara Menjalankan (Local Development)

### 1. Setup Server (Backend)
```bash
cd server
npm install
python3 -m venv .venv
.venv/bin/pip install -r engine/requirements.txt
cp .env.example .env

# Jalankan server backend (Port: 5200)
npm run dev
```

### 2. Setup Client (Frontend)
Buka terminal baru di folder proyek:
```bash
cd client
npm install

# Jalankan dev server frontend (Port: 5173)
npm run dev
```

Akses web melalui browser di: **`http://localhost:5173/`**

---

## 🌐 Deploy ke VPS (Production)

### 1. Build Client
```bash
cd client
npm run build
```
Output build akan otomatis diletakkan di `/server/dist` dan di-serve langsung oleh backend Node.js.

### 2. Menjalankan Server di VPS dengan PM2
```bash
cd server
npm install --omit=dev
python3 -m venv .venv
.venv/bin/pip install -r engine/requirements.txt
cp .env.example .env

# Jalankan backend
pm2 start index.js --name "music-idl"
pm2 save
```

### 3. Konfigurasi Caddy (Reverse Proxy)
Arahkan domain ke port `5200` pada file `/etc/caddy/Caddyfile`:

```caddy
musicidl.web.id, app.musicidl.web.id {
    reverse_proxy localhost:5200
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## ⚙️ Konfigurasi Environment (`.env`)

Buat file `.env` di folder `server/` dari contoh yang tersedia. Konfigurasi penting:

```env
NODE_ENV=production
PORT=5200
SITE_URL=https://musicidl.web.id
PYTHON_BIN=.venv/bin/python
YT_DLP_BIN=.venv/bin/yt-dlp
FFMPEG_BIN=ffmpeg
DENO_BIN=deno
DOWNLOAD_PROXY=
ALLOW_REMOTE_COMPONENTS=false
ENGINE_TIMEOUT_MS=600000
MAX_ACTIVE_DOWNLOADS=2
MAX_QUEUED_DOWNLOADS=8
JOB_TTL_MS=3600000
HEALTHCHECK_BINARIES=true
MAX_DURATION_SECONDS=900
MAX_SOURCE_BYTES=104857600
```

`DOWNLOAD_PROXY` boleh dikosongkan. Jangan mengaktifkan `ALLOW_REMOTE_COMPONENTS` kecuali deployment memang memerlukan komponen yt-dlp dari GitHub dan risikonya sudah dipahami.

## Batas keamanan

Backend hanya menerima URL HTTPS dari hostname YouTube yang didukung. Satu IP hanya boleh memiliki satu job aktif/menunggu; jumlah job global, antrean, durasi media, ukuran sumber, dan waktu proses dibatasi melalui `.env`. Direktori job lama dibersihkan otomatis saat server mulai.

## Alur unduhan dan kualitas

- **MP3**: 128, 192, atau 320 kbps. Default UI adalah 192 kbps; menaikkan bitrate tidak dapat menambah detail yang tidak ada pada sumber.
- **Fast Mode**: mengambil stream audio M4A/WebM/Opus tanpa encoding ulang. Mode ini lebih cepat dan tidak menanam artwork tambahan agar file sumber tidak diubah.
- UI membuat job, membaca status setiap satu detik, lalu mengambil file ketika status `completed`.
- Job selesai, gagal, atau dibatalkan disimpan maksimal selama `JOB_TTL_MS`. File dibersihkan setelah dikirim atau saat TTL habis.

API utama:

- `POST /api/jobs` — membuat job dari `{ url, format, bitrate }`;
- `GET /api/jobs/:id` — membaca progres aman tanpa URL/path internal;
- `DELETE /api/jobs/:id` — membatalkan job;
- `POST /api/jobs/:id/retry` — mencoba ulang job gagal/dibatalkan;
- `GET /api/jobs/:id/file` — mengambil hasil yang sudah selesai;
- `GET /api/health` — readiness binary, output directory, dan kapasitas antrean.

Job disimpan di memori satu proses. Jalankan PM2 dalam mode fork satu instance seperti contoh di atas. Gunakan antrean bersama seperti Redis/BullMQ hanya ketika aplikasi benar-benar perlu banyak instance.

## Verifikasi lokal

```bash
npm --prefix server test
npm --prefix server run test:engine
npm --prefix client test
npm --prefix client run lint
npm --prefix client run build
```

Integration test server memakai engine fixture lokal sehingga create, progres, MP3/Fast Mode, cancel, retry, health, dan transfer file diuji tanpa akses YouTube. Unduhan YouTube nyata tetap perlu smoke test di server yang memiliki jaringan, yt-dlp, Deno, dan FFmpeg.

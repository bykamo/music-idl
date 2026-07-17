<div align="center">

<img src="client/public/favicon.webp" alt="Music IDL Logo" width="96" />

# 🎵 Music IDL

**Pencarian dan pengunduhan musik melalui antarmuka web modern.**

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

Cari lagu YouTube Music atau tempel tautan YouTube/Apple Music, lihat metadata, lalu proses unduhan MP3 dari satu aplikasi.

</div>

---

## Tentang

Music IDL adalah aplikasi full-stack dengan frontend React dan backend Express. Backend menangani pencarian YouTube Music, integrasi provider download eksternal, fallback API key, proxy streaming, penyisipan metadata ID3, optimasi cover art, pembatasan request, dan penyajian production build frontend.

> Gunakan hanya untuk konten yang Anda miliki, berlisensi bebas, atau memang diizinkan untuk diunduh. Patuhi hak cipta dan ketentuan layanan platform terkait.

## Fitur

### Pencarian dan input

- Cari lagu/video melalui YouTube Music.
- Tempel tautan YouTube, `youtu.be`, YouTube Shorts, atau Apple Music.
- Deteksi platform otomatis berdasarkan tautan.
- Tombol paste dengan fallback untuk browser yang membatasi Clipboard API.
- Tampilan hasil beserta judul, artis/channel, thumbnail, durasi, ukuran, dan bitrate jika tersedia.

### Download dan metadata

- Meminta sumber MP3 hingga 320 kbps melalui provider yang dikonfigurasi.
- Main API key dan backup API key untuk fallback.
- Proxy download melalui backend agar progres dapat ditampilkan di browser.
- Penamaan file otomatis dari judul lagu.
- Penyisipan metadata ID3 seperti judul, artis, album, dan cover art.
- Pemrosesan gambar cover menggunakan Sharp.
- Penanganan URL provider yang masih berstatus antre/diproses.

### UX dan operasional

- Dark mode dan light mode tersimpan di browser.
- UI responsif dengan Tailwind CSS dan animasi Framer Motion.
- Loading skeleton, progress pencarian, progress download, dan dialog limit/error.
- Rate limit API umum: 100 request per 15 menit per IP.
- Batas download aplikasi: 5 download per IP per hari.
- CORS allowlist untuk domain produksi dan localhost.
- Compression dan caching static assets.
- Endpoint `robots.txt` dan `sitemap.xml`.
- Docker multi-stage untuk deployment.

## Tech Stack

| Bagian | Teknologi | Kegunaan |
|---|---|---|
| Frontend | React 19 + TypeScript 6 | UI dan type-safe client logic |
| Build tool | Vite 8 | Development server dan production bundle |
| Styling | Tailwind CSS 3.4 | Responsive UI dan theme styling |
| Animasi | Framer Motion | Transisi dan micro-interactions |
| HTTP client | Axios | Komunikasi client-server dan provider eksternal |
| Backend | Node.js 22 + Express 5 | REST API, proxy, dan static file server |
| Music search | ytmusic-api | Pencarian lagu/video YouTube Music |
| Metadata | node-id3 | Penulisan tag ID3 pada MP3 |
| Image processing | Sharp | Normalisasi dan optimasi cover art |
| Runtime data | JSON file | Penghitung limit download harian |
| Deployment | Docker Compose | Build dan menjalankan full-stack app |

## Arsitektur Singkat

```text
Browser (React/Vite)
        │
        ▼
Express API (/api/*)
        ├── YouTube Music search
        ├── External download provider
        ├── Main/backup API-key fallback
        ├── MP3 proxy + ID3 metadata
        └── Daily download limiter
```

## Struktur Project

```text
music-idl/
├── client/
│   ├── public/              # Favicon dan aset publik
│   ├── src/
│   │   ├── components/ui/   # Ikon, loader, dialog, theme toggle
│   │   ├── App.tsx          # Search, metadata, dan download flow
│   │   └── main.tsx         # React entry point
│   └── package.json         # Dependensi dan script frontend
├── server/
│   ├── index.js             # Express API dan production server
│   ├── downloads.json       # Runtime counter download
│   └── package.json         # Dependensi dan script backend
├── .env.example             # Template konfigurasi server
├── Dockerfile               # Multi-stage container build
└── docker-compose.yml       # Service pada port 5200
```

## Menjalankan Secara Lokal

### Prasyarat

- Node.js 22 direkomendasikan.
- npm.
- API key provider download yang digunakan aplikasi.

### 1. Clone repository

```bash
git clone https://github.com/kam2k-dev/music-idl.git
cd music-idl
```

### 2. Konfigurasi environment

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Isi `.env` lokal:

```env
PORT=5200
API_KEY=your_primary_provider_api_key
BACKUP_API_KEY=your_backup_provider_api_key
```

> `.env` dan `server/.env` diabaikan Git. Jangan commit API key asli ke repository.

### 3. Instal dependensi

Backend:

```bash
cd server
npm install
```

Frontend, dari terminal lain:

```bash
cd client
npm install
```

### 4. Jalankan mode development

Backend:

```bash
cd server
npm run dev
```

Frontend:

```bash
cd client
npm run dev
```

Frontend Vite biasanya tersedia di `http://localhost:5173`, sementara API backend berjalan di `http://localhost:5200`.

> Client saat ini memanggil path relatif `/api`. Untuk development lintas port, konfigurasi proxy Vite atau reverse proxy diperlukan agar request `/api` diteruskan ke backend.

## Scripts

### Frontend

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Menjalankan Vite development server |
| `npm run build` | Type-check dan production build |
| `npm run lint` | Menjalankan ESLint |
| `npm run preview` | Preview production build |

### Backend

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan Express dengan Node.js |
| `npm run dev` | Menjalankan server melalui Nodemon |

## Menjalankan dengan Docker

Pastikan `.env` sudah tersedia, lalu jalankan:

```bash
docker compose up --build -d
```

Buka:

```text
http://localhost:5200
```

Perintah operasional:

```bash
docker compose logs -f
docker compose restart
docker compose down
```

## Endpoint Utama

| Endpoint | Fungsi |
|---|---|
| `GET /api/search?q=...` | Mencari lagu atau video |
| `GET /api/url-info?url=...` | Mengambil metadata dari tautan |
| `GET /api/external-info?videoId=...` | Mengambil detail dari provider |
| `GET /api/download?url=...` | Meminta URL hasil download |
| `GET /api/fallback-download?videoId=...` | Mencoba provider fallback |
| `GET /api/proxy-download?...` | Proxy file dan menambahkan metadata MP3 |
| `GET /robots.txt` | Aturan crawler |
| `GET /sitemap.xml` | Sitemap halaman utama |

## Keamanan dan Privasi

- Simpan API key hanya di environment server.
- Jangan mengekspos `.env`, service credential, atau key provider ke frontend.
- Terapkan pembatasan key di dashboard provider jika tersedia.
- Sesuaikan CORS allowlist dengan domain deployment Anda.
- Jangan commit `downloads.json` produksi karena dapat memuat identifier IP pengguna.
- Gunakan reverse proxy HTTPS untuk deployment publik.
- Audit dependency secara berkala dengan `npm audit`.

## Catatan Lisensi

Repository belum memiliki file lisensi proyek di root. Karena itu, secara default seluruh hak cipta tetap dimiliki pemilik repository. Nilai `ISC` pada `server/package.json` hanya metadata package backend dan bukan pengganti file lisensi proyek secara keseluruhan.

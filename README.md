# Music Downloader (Music-IDL)

Aplikasi Web untuk mengunduh lagu dari YouTube dan Apple Music dengan kualitas tinggi (320kbps) lengkap dengan metadata otomatis (Judul, Artis, Album, Cover Art).

## Struktur Project

* `/client`: Frontend menggunakan React + Vite + TypeScript + Tailwind CSS.
* `/server`: Backend menggunakan Node.js + Express.

## Persiapan & Konfigurasi

Buat file `.env` di root folder dengan konfigurasi berikut:

```env
PORT=5000
API_KEY=R0yZv
BACKUP_API_KEY=t0uQP
```

* `PORT`: Port server backend (default: 5000).
* `API_KEY`: API Key Utama untuk TheresaV API.
* `BACKUP_API_KEY`: API Key Cadangan untuk TheresaV API.

## Cara Menjalankan Menggunakan Docker

Anda dapat menjalankan aplikasi ini dengan mudah menggunakan Docker atau Docker Compose.

### Menggunakan Docker Compose (Direkomendasikan)

1. Pastikan Docker dan Docker Compose sudah terinstal di komputer Anda.
2. Jalankan perintah berikut di root folder project:
   ```bash
   docker-compose up -d --build
   ```
3. Buka browser dan akses `http://localhost:5000`.

### Menggunakan Docker CLI secara Manual

1. Build image Docker:
   ```bash
   docker build -t music-idl .
   ```
2. Jalankan container:
   ```bash
   docker run -d -p 5000:5000 --env-file .env --name music-idl-app music-idl
   ```
3. Buka browser dan akses `http://localhost:5000`.


# 🎵 Music Downloader (Music-IDL)

Aplikasi Web modern untuk mencari dan mengunduh lagu dari YouTube dan Apple Music dalam format MP3 kualitas tinggi (320kbps) lengkap dengan metadata otomatis (Judul, Artis, Album, dan Cover Art 1:1 Apple Music standard).

---

## 📂 Struktur Proyek

* `/client`: Frontend (React + Vite + TypeScript + Tailwind CSS)
* `/server`: Backend Server (Node.js + Express)
* `/server/engine`: Engine Pengunduh Musik (Python `yt-dlp` & `ffmpeg`)

---

## ⚙️ Prasyarat (Requirements)

Sebelum menjalankan aplikasi, pastikan sistem kamu sudah menginstal:

1. **Node.js** (v18 atau lebih baru) & **npm**
2. **Python 3** (v3.8 atau lebih baru)
   - Pastikan opsi **"Add Python to PATH"** tercentang saat instalasi.
3. **FFmpeg**
   - **Windows:** Download dari [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) dan masukkan folder `bin` ke Environment Variables (PATH).
   - **macOS:** `brew install ffmpeg`
   - **Linux (Ubuntu/Debian):** `sudo apt update && sudo apt install ffmpeg python3-pip`
4. **yt-dlp** (Library Python)
   - Install via terminal/CMD:
     ```bash
     pip install yt-dlp
     ```

---

## 🚀 Cara Menjalankan (Local Development)

### 1. Setup Server (Backend)
```bash
cd server
npm install

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
Copy folder `client/dist` ke folder `server/dist`.

### 2. Menjalankan Server di VPS dengan PM2
```bash
cd server
npm install --omit=dev

# Install PM2 jika belum ada
npm install -g pm2

# Jalankan backend
pm2 start index.js --name "music-idl"
pm2 save
```

Aplikasi akan berjalan di port `5200` dan dapat di-proxy menggunakan Nginx.

---

## ⚙️ Konfigurasi Environment (`.env`)

File `.env` di folder `server/`:

```env
PORT=5200
```

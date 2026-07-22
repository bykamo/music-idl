# 🎵 Music Downloader (Music-IDL)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind_CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwindcss&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![PM2](https://img.shields.io/badge/PM2-2B826B?style=flat&logo=pm2&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-00A2C9?style=flat&logo=caddy&logoColor=white)

Aplikasi Web modern berkecepatan tinggi untuk mencari dan mengunduh musik dari YouTube Music dalam format MP3 berkualitas tinggi (320kbps) lengkap dengan metadata otomatis (Judul, Artis, dan Cover Art 1:1) tanpa iklan atau batasan.

---

## 📂 Struktur Proyek

* `/client`: Frontend (React + Vite + TypeScript + Tailwind CSS)
* `/server`: Backend Server (Node.js + Express)
* `/server/engine`: Engine Pengunduh Musik (Python `yt-dlp` & `ffmpeg` via SOCKS5 Proxy)

---

## ⚙️ Prasyarat (Requirements)

Sebelum menjalankan aplikasi, pastikan sistem kamu sudah menginstal:

1. **Node.js** (v18 atau lebih baru) & **npm**
2. **Python 3** (v3.8 atau lebih baru)
3. **FFmpeg** (untuk konversi format ke MP3)
4. **Cloudflare WARP** (untuk bypass limitasi regional/block IP YouTube)

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
Output build akan otomatis diletakkan di `/server/dist` dan di-serve langsung oleh backend Node.js.

### 2. Menjalankan Server di VPS dengan PM2
```bash
cd server
npm install --omit=dev

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

Buat file `.env` di folder `server/`:

```env
PORT=5200
```

# Download Jobs Design

## Goal

Mengubah unduhan audio dari satu request HTTP panjang menjadi job asinkron yang memiliki progres nyata, pembatalan, retry, pilihan kualitas MP3 atau format asli, pengambilan file terpisah, health check, dan integration test tanpa menambah infrastruktur eksternal.

## Scope

Paket ini mencakup:

- job unduhan in-memory untuk satu proses Node.js;
- antrean global dan pembatasan satu job aktif atau mengantre per IP;
- progres aktual dari engine Python/yt-dlp;
- cancel untuk job mengantre maupun aktif;
- retry untuk job gagal atau dibatalkan;
- endpoint file yang hanya tersedia setelah job selesai;
- health/readiness check untuk dependency lokal dan kapasitas antrean;
- pilihan MP3 128, 192, atau 320 kbps dengan default 192 kbps;
- Fast Mode yang menyimpan stream audio asli M4A/WebM tanpa encoding ulang;
- ukuran, format, dan bitrate hasil yang diambil dari file/job sebenarnya;
- UI progres, cancel, retry, dan pengambilan hasil;
- integration test HTTP dengan engine fixture lokal tanpa akses YouTube.

Paket ini tidak mencakup Redis, BullMQ, database, persistensi melewati restart, playlist, akun pengguna, pemulihan job setelah browser dimuat ulang, atau output FLAC. FLAC tidak ditawarkan karena sumber YouTube bukan lossless.

## Architecture

Server memiliki satu `DownloadJobManager` in-memory. Manager menyimpan record job, menjalankan maksimum `MAX_ACTIVE_DOWNLOADS`, menahan maksimum `MAX_QUEUED_DOWNLOADS`, dan menolak job kedua dari IP yang sama selama job pertama belum terminal. Job ID menggunakan `crypto.randomUUID()` sehingga berfungsi sebagai capability token yang sulit ditebak.

Engine Node dijalankan memakai `spawn`, bukan `execFile`, agar stderr dapat dibaca per baris. Engine Python mengirim event JSON satu baris dengan prefix tetap ke stderr. Stdout tetap hanya berisi hasil akhir JSON agar kontrak hasil file tidak tercampur log.

Client membuat job lalu melakukan polling status setiap satu detik. Polling dipilih daripada SSE karena lebih sederhana, tahan reconnect, dan tidak bergantung pada konfigurasi buffering reverse proxy. Polling berhenti saat status terminal atau komponen dibongkar.

## Job Lifecycle

Status job yang dapat dilihat client:

- `queued`: menunggu slot;
- `running`: engine sedang berjalan;
- `completed`: file audio siap diambil;
- `failed`: engine gagal atau timeout;
- `cancelled`: dibatalkan pengguna.

Stage progres:

- `queued` dengan progres `0`;
- `metadata` dengan progres minimum `2`;
- `downloading` dengan progres yt-dlp dipetakan ke `5..82`;
- `encoding` dengan progres `88`;
- `tagging` dengan progres `94`;
- `completed` dengan progres `100`.

Persentase tidak boleh mundur. Jika yt-dlp tidak menyediakan ukuran total, client tetap menerima stage aktual dan persentase terakhir yang diketahui. Pesan status bersifat tetap dan aman; stderr mentah atau URL sumber tidak dikirim ke client.

Job terminal disimpan sampai `JOB_TTL_MS`. File job yang selesai juga dibersihkan saat TTL berakhir. Setelah transfer file selesai, file dan record job dihapus. Pembersihan dijalankan berkala dan saat startup untuk direktori lama.

## HTTP API

### `POST /api/jobs`

Body:

```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "format": "mp3",
  "bitrate": 192
}
```

Server menormalisasi URL dengan policy YouTube yang sudah ada, menerapkan rate limit unduhan, dan memvalidasi format. `format` hanya menerima `mp3` atau `original`; `bitrate` hanya menerima `128`, `192`, atau `320` dan wajib untuk MP3. Fast Mode memakai `format: "original"` dan mengabaikan bitrate. Server lalu mengembalikan HTTP `202`:

```json
{
  "id": "opaque-uuid",
  "status": "queued",
  "stage": "queued",
  "progress": 0,
  "outputFormat": "mp3",
  "bitrate": 192
}
```

Antrean penuh mengembalikan `503 DOWNLOAD_QUEUE_FULL`; IP yang masih memiliki job non-terminal mengembalikan `429 DOWNLOAD_ALREADY_ACTIVE`.

### `GET /api/jobs/:id`

Mengembalikan snapshot publik job. Respons tidak menyertakan URL sumber, path filesystem, IP, stderr, atau command engine.

```json
{
  "id": "opaque-uuid",
  "status": "running",
  "stage": "downloading",
  "progress": 47,
  "message": "Mengunduh audio...",
  "fileName": null,
  "fileSize": null,
  "outputFormat": "mp3",
  "bitrate": 192,
  "error": null
}
```

Job yang tidak ada atau sudah kedaluwarsa mengembalikan `404 JOB_NOT_FOUND`.

### `DELETE /api/jobs/:id`

Membatalkan job `queued` atau `running`, menghentikan child process melalui `AbortController`, dan membersihkan file parsial. Respons HTTP `202` berisi snapshot berstatus `cancelled`. Job terminal lain mengembalikan `409 JOB_NOT_CANCELLABLE`.

### `POST /api/jobs/:id/retry`

Hanya menerima job `failed` atau `cancelled`. Server membuat job baru dengan URL dan client identity yang sama serta mengembalikan HTTP `202`. Job lama tetap sebagai record terminal sampai TTL. Retry melewati endpoint create yang sama sehingga rate limit, validasi, kapasitas antrean, dan aturan satu job per IP tetap berlaku.

### `GET /api/jobs/:id/file`

Hanya menerima job `completed`. Server memvalidasi ulang bahwa path berada di direktori job dan berekstensi `.mp3`, `.m4a`, `.webm`, atau `.opus`, lalu memakai `res.download` dengan MIME yang sesuai. Status lain mengembalikan `409 JOB_NOT_READY`. Setelah callback transfer, direktori dan record job dibersihkan.

### `GET /api/health`

Mengembalikan HTTP `200` jika server siap menerima job dan `503` jika dependency wajib atau output directory tidak siap. Respons hanya berisi boolean/status aman untuk:

- Node process;
- Python;
- yt-dlp;
- FFmpeg;
- output directory;
- jumlah job aktif dan mengantre;
- kapasitas maksimum antrean.

Deno diperiksa hanya jika `DENO_BIN` tidak kosong. Pemeriksaan binary memakai command versi dengan timeout singkat dan hasilnya dicache agar health check tidak membuat proses baru setiap request.

## Engine Progress Protocol

Engine menerima argumen `--format mp3 --bitrate 192` atau `--format original`. Mode MP3 memakai postprocessor FFmpeg dan menanam artwork/metadata seperti alur yang ada. Mode original memilih stream audio terbaik berformat M4A atau WebM/Opus, tidak menjalankan ekstraksi MP3, dan tidak menanam artwork agar file tidak di-encode atau di-remux ulang.

Engine menulis event berikut ke stderr:

```text
MUSIC_IDL_EVENT {"stage":"metadata","progress":2}
MUSIC_IDL_EVENT {"stage":"downloading","progress":46}
MUSIC_IDL_EVENT {"stage":"encoding","progress":88}
MUSIC_IDL_EVENT {"stage":"tagging","progress":94}
```

`progress_hooks` yt-dlp menghasilkan event download. `postprocessor_hooks` menghasilkan event encoding khusus MP3. Fungsi finalisasi metadata menghasilkan event tagging khusus MP3. Fast Mode bergerak dari download langsung ke completed. Event invalid diabaikan oleh Node; log stderr biasa tetap hanya dicatat di server. Node membatasi buffer stdout/stderr dan membatasi progres ke bilangan bulat `0..100`.

## Client Experience

Kartu lagu menyediakan pemilih `MP3` atau `Fast Mode`. MP3 menyediakan pilihan 128, 192, dan 320 kbps; default-nya 192 kbps. Pilihan terakhir disimpan di `localStorage`. Tombol unduh membuat job dan berubah menjadi panel progres pada kartu lagu. Panel menampilkan stage manusiawi, progress bar, persentase, dan tombol `Batalkan`. Saat gagal atau dibatalkan, panel menampilkan pesan aman dan tombol `Coba Lagi`. Saat selesai, client menampilkan nama, ukuran, dan format aktual lalu browser mengambil `/api/jobs/:id/file`; UI menandai berhasil setelah navigasi download dipicu.

Hanya satu job client yang dikelola UI pada satu waktu, sesuai aturan server per IP. Timer polling dan request yang masih berjalan dibersihkan ketika komponen dibongkar atau job diganti.

## Error Handling and Security

- Semua URL melewati `normalizeYouTubeUrl` sebelum disimpan atau dijalankan.
- Format dan bitrate divalidasi dengan allowlist di server; nilai client tidak pernah diteruskan mentah menjadi argumen command.
- Job ID divalidasi sebagai UUID sebelum lookup.
- Record publik tidak membocorkan URL, IP, path, atau output proses.
- Create dan retry memakai download rate limiter; polling, cancel, file, dan health tetap dilindungi general API limiter.
- Cancel bersifat idempotent pada child process tetapi endpoint tetap melaporkan conflict untuk job terminal.
- Timeout engine menghasilkan `failed` dengan kode `DOWNLOAD_TIMEOUT`.
- Abort pengguna menghasilkan `cancelled`, bukan `failed`.
- File hanya dapat dikirim dari direktori job yang sesuai dan harus berekstensi `.mp3`, `.m4a`, `.webm`, atau `.opus`.
- Shutdown server menghentikan job aktif dan membersihkan child process.

## Compatibility

Client baru hanya memakai job API. Endpoint metadata tetap dipertahankan. Endpoint lama `/api/engine-download` dipertahankan sementara untuk kompatibilitas, tetapi menggunakan runner yang sama dan tetap dibatasi rate limit/gate; endpoint ini tidak dipakai UI baru. Penghapusan endpoint legacy dapat dilakukan setelah deployment baru terbukti stabil.

## Testing

### Unit tests

- state transition dan progres monoton;
- antrean dan batas global;
- penolakan duplicate client;
- cancel queued dan running;
- retry hanya dari status terminal yang diizinkan;
- expiry/cleanup;
- parsing event engine dan penolakan path hasil tidak aman;
- helper client untuk status/stage dan URL file internal;
- validasi kombinasi format/bitrate dan persistensi preferensi client;
- opsi yt-dlp untuk setiap kualitas MP3 serta Fast Mode tanpa postprocessor audio.

### HTTP integration tests

Server test dijalankan sebagai child process dengan engine fixture Node lokal. Fixture dapat mengirim progres, selesai dengan MP3/M4A dummy, gagal, atau menunggu sampai dibatalkan. Test membuktikan create → poll → completed → file, cancel, retry, validasi URL/format/bitrate, metadata ukuran hasil, dan health response tanpa jaringan eksternal.

### Static and regression verification

- server Node tests;
- Python unit tests;
- client Node tests;
- ESLint;
- TypeScript/Vite build;
- syntax checks Node/Python;
- dependency audits;
- `git diff --check`.

Download YouTube/FFmpeg nyata tetap merupakan smoke test staging terpisah karena membutuhkan jaringan dan binary runtime yang sebenarnya.

const express = require('express');
const axios = require('axios');
const YTMusic = require('ytmusic-api');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const { execFile } = require('child_process');
const {
    DownloadGate,
    normalizeYouTubeUrl,
    videoUrlFromId
} = require('./lib/download-policy');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5200;
const SITE_URL = process.env.SITE_URL || 'https://musicidl.web.id';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const YT_DLP_BIN = process.env.YT_DLP_BIN || 'yt-dlp';
const DOWNLOAD_PROXY = process.env.DOWNLOAD_PROXY || '';
const ENGINE_TIMEOUT_MS = Number.parseInt(process.env.ENGINE_TIMEOUT_MS || '600000', 10);
const INFO_TIMEOUT_MS = Number.parseInt(process.env.INFO_TIMEOUT_MS || '30000', 10);
const MAX_ACTIVE_DOWNLOADS = Number.parseInt(process.env.MAX_ACTIVE_DOWNLOADS || '2', 10);
const MAX_QUEUED_DOWNLOADS = Number.parseInt(process.env.MAX_QUEUED_DOWNLOADS || '8', 10);
const downloadGate = new DownloadGate({
    maxActive: Math.max(1, MAX_ACTIVE_DOWNLOADS || 2),
    maxQueued: Math.max(0, MAX_QUEUED_DOWNLOADS || 0)
});

app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; img-src 'self' data: https://i.ytimg.com https://*.mzstatic.com; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    );
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});
app.use(express.json({ limit: '16kb' }));

// Trust Proxy for accurate IP on VPS
app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));

// General Rate Limiter to prevent API abuse/spam
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    message: { error: 'TOO_MANY_REQUESTS', message: 'Terlalu banyak permintaan dari IP ini, silakan coba lagi nanti.' }
});
app.use('/api/', apiLimiter);

const downloadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: 'DOWNLOAD_RATE_LIMIT', message: 'Batas unduhan per jam tercapai. Coba lagi nanti.' }
});

// Logger
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);
});

const ytmusic = new YTMusic();
let ytmusicInitPromise;

async function initYT() {
    if (!ytmusicInitPromise) {
        ytmusicInitPromise = ytmusic.initialize().then(() => {
            console.log('YTMusic initialized');
        }).catch(err => {
            ytmusicInitPromise = undefined;
            throw err;
        });
    }
    return ytmusicInitPromise;
}

// Serve Static Files (React Build)
app.use(express.static(path.join(__dirname, 'dist'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (path.match(/\.(js|css|woff2|svg|png|jpg|jpeg)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
    }
}));

// Helper to run python music_dl_engine script
const engineScriptPath = path.join(__dirname, 'engine', 'music_dl.py');
const outputDir = path.join(__dirname, 'output_music');
const JOB_TTL_MS = Number.parseInt(process.env.JOB_TTL_MS || '3600000', 10);

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('job-')) continue;
    const jobDir = path.join(outputDir, entry.name);
    try {
        if (Date.now() - fs.statSync(jobDir).mtimeMs > JOB_TTL_MS) {
            fs.rmSync(jobDir, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn(`Tidak dapat membersihkan job lama ${entry.name}:`, err.message);
    }
}

function removeJobDir(jobDir) {
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
}

function runEngineDownload(url, signal) {
    return new Promise((resolve, reject) => {
        const jobDir = fs.mkdtempSync(path.join(outputDir, 'job-'));
        try {
            execFile(PYTHON_BIN, [engineScriptPath, url, jobDir], {
                cwd: __dirname,
                env: process.env,
                maxBuffer: 5 * 1024 * 1024,
                timeout: Math.max(1000, ENGINE_TIMEOUT_MS || 600000),
                signal
            }, (error, stdout, stderr) => {
                if (error) {
                    if (stderr) console.error('Engine error:', stderr.slice(-4000));
                    removeJobDir(jobDir);
                    return reject(error);
                }

                try {
                    const resultLine = stdout.trim().split('\n').filter(Boolean).at(-1);
                    const result = JSON.parse(resultLine);
                    const fullPath = path.resolve(result.file_path);
                    const relativePath = path.relative(jobDir, fullPath);
                    if (
                        result.status !== 'ok'
                        || relativePath.startsWith('..')
                        || path.isAbsolute(relativePath)
                        || path.extname(fullPath).toLowerCase() !== '.mp3'
                        || !fs.existsSync(fullPath)
                    ) {
                        throw new Error('Engine returned an invalid MP3 path');
                    }
                    resolve({ filePath: fullPath, fileName: path.basename(fullPath), jobDir });
                } catch (err) {
                    removeJobDir(jobDir);
                    reject(err);
                }
            });
        } catch (err) {
            removeJobDir(jobDir);
            reject(err);
        }
    });
}

function sendPolicyError(res, err) {
    if (err && err.statusCode) {
        return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    return null;
}

// API Routes
app.get('/api/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) return res.status(400).json({ error: 'INVALID_QUERY', message: 'Masukkan judul lagu.' });
    if (query.length > 200) {
        return res.status(400).json({ error: 'INVALID_QUERY', message: 'Pencarian maksimal 200 karakter.' });
    }
    if (/^https?:\/\//i.test(query)) {
        return res.status(400).json({
            error: 'UNSUPPORTED_URL',
            message: 'Saat ini hanya link video YouTube yang didukung.'
        });
    }

    try {
        await initYT();
        const results = await ytmusic.search(query);
        const filtered = results.filter(item => item.type === 'SONG' || item.type === 'VIDEO');
        res.json(filtered);
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(503).json({ error: 'SEARCH_UNAVAILABLE', message: 'Pencarian sedang tidak tersedia.' });
    }
});

app.get('/api/external-info', async (req, res) => {
    try {
        const targetUrl = videoUrlFromId(req.query.videoId);
        const info = await getYoutubeVideoInfo(targetUrl, req.query.videoId);
        return res.json({
            status: true,
            title: info.title,
            channel: info.uploader,
            duration_sec: info.duration || 0,
            bitrate: 'hingga 320kbps',
            filesize: 0,
            view_count: info.viewCount || 0,
            like_count: info.likeCount || 0,
            upload_date: info.uploadDate || '',
            thumbnail: info.thumbnail,
            download_url: `/api/engine-download?url=${encodeURIComponent(targetUrl)}`
        });
    } catch (err) {
        if (sendPolicyError(res, err)) return;
        console.error('Metadata error:', err.message);
        res.status(502).json({ error: 'METADATA_UNAVAILABLE', message: 'Metadata video tidak dapat diambil.' });
    }
});

app.get('/api/download', (req, res) => {
    try {
        const targetUrl = req.query.url
            ? normalizeYouTubeUrl(req.query.url)
            : videoUrlFromId(req.query.v);
        return res.json({
            download_url: `/api/engine-download?url=${encodeURIComponent(targetUrl)}`,
            title: 'Music Download',
            thumbnail: '',
            channel: 'Music IDL Engine',
            status: true
        });
    } catch (err) {
        return sendPolicyError(res, err) || res.status(400).json({ error: 'INVALID_DOWNLOAD' });
    }
});

async function getOEmbedFallback(url, videoId) {
    try {
        const response = await axios.get('https://www.youtube.com/oembed', {
            params: { url, format: 'json' },
            timeout: 5000,
            maxContentLength: 256 * 1024
        });
        if (response.data && response.data.title) {
            return {
                title: response.data.title,
                uploader: response.data.author_name || 'YouTube Artist',
                thumbnail: response.data.thumbnail_url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
                duration: 0,
                viewCount: 0,
                likeCount: 0,
                uploadDate: ''
            };
        }
    } catch {}
    const defaultTitle = videoId && videoId.length === 11 ? `YouTube Track ${videoId}` : 'YouTube Track';
    return {
        title: defaultTitle,
        uploader: 'Music IDL Engine',
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '',
        duration: 0,
        viewCount: 0,
        likeCount: 0,
        uploadDate: ''
    };
}

function getYoutubeVideoInfo(url, videoId) {
    return new Promise((resolve) => {
        const args = ['--dump-single-json', '--no-playlist', '--socket-timeout', '15'];
        if (DOWNLOAD_PROXY) args.push('--proxy', DOWNLOAD_PROXY);
        args.push(url);
        execFile(YT_DLP_BIN, args, {
            timeout: Math.max(1000, INFO_TIMEOUT_MS || 30000),
            maxBuffer: 5 * 1024 * 1024
        }, async (error, stdout) => {
            if (error) {
                console.error('Info extract error, using oEmbed fallback:', error.message);
                const fallbackInfo = await getOEmbedFallback(url, videoId);
                return resolve(fallbackInfo);
            }
            try {
                const info = JSON.parse(stdout);
                resolve({
                    title: info.title || (videoId ? `YouTube Track ${videoId}` : 'YouTube Track'),
                    uploader: info.uploader || info.artist || 'Music IDL Engine',
                    thumbnail: info.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
                    duration: info.duration || 0,
                    viewCount: info.view_count || 0,
                    likeCount: info.like_count || 0,
                    uploadDate: info.upload_date || ''
                });
            } catch {
                const fallbackInfo = await getOEmbedFallback(url, videoId);
                resolve(fallbackInfo);
            }
        });
    });
}

app.get('/api/url-info', async (req, res) => {
    try {
        const targetUrl = normalizeYouTubeUrl(req.query.url);
        const videoId = new URL(targetUrl).searchParams.get('v');
        const info = await getYoutubeVideoInfo(targetUrl, videoId);
        const thumbnail = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return res.json({
            videoId,
            name: info.title,
            artist: { name: info.uploader },
            thumbnails: [{ url: thumbnail, width: 480, height: 360 }],
            type: 'SONG',
            isDirect: true,
            externalData: {
                download_url: `/api/engine-download?url=${encodeURIComponent(targetUrl)}`,
                title: info.title,
                channel: info.uploader,
                thumbnail,
                status: true,
                bitrate: 'hingga 320kbps',
                filesize: 0,
                duration_sec: info.duration || 0,
                view_count: info.viewCount || 0,
                like_count: info.likeCount || 0,
                upload_date: info.uploadDate || ''
            }
        });
    } catch (err) {
        if (sendPolicyError(res, err)) return;
        console.error('URL metadata error:', err.message);
        return res.status(502).json({ error: 'METADATA_UNAVAILABLE', message: 'Metadata video tidak dapat diambil.' });
    }
});

app.get('/api/fallback-download', (req, res) => {
    try {
        const targetUrl = videoUrlFromId(req.query.videoId);
        return res.json({
            status: true,
            download_url: `/api/engine-download?url=${encodeURIComponent(targetUrl)}`,
            title: 'YouTube Track',
            channel: 'Artist',
            thumbnail: `https://i.ytimg.com/vi/${req.query.videoId}/hqdefault.jpg`
        });
    } catch (err) {
        return sendPolicyError(res, err) || res.status(400).json({ error: 'INVALID_VIDEO_ID' });
    }
});

app.get('/api/engine-download', downloadLimiter, async (req, res) => {
    const abortController = new AbortController();
    let engineFinished = false;
    res.once('close', () => {
        if (!engineFinished) abortController.abort();
    });

    try {
        const targetUrl = normalizeYouTubeUrl(req.query.url);
        const videoId = new URL(targetUrl).searchParams.get('v');
        console.log(`[Engine] Memproses video ${videoId}`);
        const clientId = req.ip || req.socket.remoteAddress || 'unknown';
        const { filePath, fileName, jobDir } = await downloadGate.run(
            clientId,
            () => runEngineDownload(targetUrl, abortController.signal)
        );
        engineFinished = true;

        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('File send error:', err.message);
            }
            removeJobDir(jobDir);
        });
    } catch (err) {
        engineFinished = true;
        if (sendPolicyError(res, err)) return;
        if (err.name === 'AbortError' || res.destroyed) return;
        console.error('Engine download process failed:', err.message);
        if (!res.headersSent) {
            const status = err.killed ? 504 : 500;
            res.status(status).json({
                error: err.killed ? 'DOWNLOAD_TIMEOUT' : 'DOWNLOAD_FAILED',
                message: err.killed
                    ? 'Proses unduhan melewati batas waktu.'
                    : 'Gagal mengunduh musik dari engine.'
            });
        }
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint API tidak ditemukan.' });
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

module.exports = { app };

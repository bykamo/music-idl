const express = require('express');
const cors = require('cors');
const axios = require('axios');
const YTMusic = require('ytmusic-api');
const path = require('path');
const NodeID3 = require('node-id3');
const sharp = require('sharp');
const compression = require('compression');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// API KEY CONFIGURATION
const API_KEY = process.env.API_KEY;
const BACKUP_API_KEY = process.env.BACKUP_API_KEY;

if (!API_KEY || !BACKUP_API_KEY) {
    console.warn("WARNING: API_KEY or BACKUP_API_KEY is not defined in .env file.");
}

app.use(compression());
app.use(cors());
app.use(express.json());

// Trust Proxy for accurate IP on VPS
app.set('trust proxy', 1);

// Logger
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Simple in-memory Daily Download Limiter (5 downloads per IP per day)
const downloadCounts = {};
setInterval(() => {
    // Reset limit counts at midnight every day
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        for (const key in downloadCounts) {
            delete downloadCounts[key];
        }
        console.log('Daily download counts reset.');
    }
}, 60000); // check every minute

const checkDownloadLimit = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const cleanIp = ip.split(',')[0].trim();
    const today = new Date().toDateString();

    if (!downloadCounts[cleanIp]) {
        downloadCounts[cleanIp] = { date: today, count: 0 };
    }

    if (downloadCounts[cleanIp].date !== today) {
        downloadCounts[cleanIp] = { date: today, count: 0 };
    }

    if (downloadCounts[cleanIp].count >= 5) {
        return res.status(429).json({ 
            error: 'LIMIT_REACHED', 
            message: 'Anda telah mencapai batas maksimal 5 unduhan per hari.' 
        });
    }

    req.userIp = cleanIp;
    next();
};

const incrementDownloadCount = (ip) => {
    if (downloadCounts[ip]) {
        downloadCounts[ip].count++;
        console.log(`IP ${ip} download count: ${downloadCounts[ip].count}/5`);
    }
};

const ytmusic = new YTMusic();

async function initYT() {
    try {
        await ytmusic.initialize();
        console.log('YTMusic initialized');
    } catch (err) {
        console.error('Failed to initialize YTMusic:', err.message);
    }
}

initYT();

// Serve Static Files (React Build)
app.use(express.static(path.join(__dirname, 'dist'), {
    maxAge: '7d', // Cache static assets for 7 days
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache'); // HTML always fresh
        } else if (path.match(/\.(js|css|woff2|svg|png|jpg|jpeg)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // Assets immutable
        }
    }
}));

// API Providers for Download
const PROVIDERS = [
    {
        name: 'TheresaV',
        getUrl: (videoId, key = API_KEY) => `https://api.theresav.biz.id/download/ytmp3?url=https://www.youtube.com/watch?v=${videoId}&format=mp3&bitrate=320k&apikey=${key}`,
        parse: (data) => data.status && data.download_url ? {
            download_url: data.download_url,
            title: data.title,
            thumbnail: data.thumbnail,
            channel: data.channel,
            duration: data.duration_sec,
            filesize: data.filesize,
            bitrate: data.bitrate
        } : null
    },
    {
        name: 'TheresaV-V4',
        getUrl: (videoId, key = API_KEY) => `https://api.theresav.biz.id/download/ytmp3/v4?url=https://www.youtube.com/watch?v=${videoId}&bitrate=320&apikey=${key}`,
        parse: (data) => data.status && data.result?.url ? {
            download_url: data.result.url,
            title: data.title,
            thumbnail: data.thumbnail,
            channel: data.channel,
            duration: data.duration,
            filesize: data.result.size,
            bitrate: data.result.quality
        } : null
    }
];

// API Routes
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

    if (q.startsWith('http://') || q.startsWith('https://')) {
        if (q.includes('music.apple.com') || q.includes('youtube.com') || q.includes('youtu.be')) {
            return res.json([{ type: 'URL_REDIRECT', url: q }]);
        }
    }

    try {
        const results = await ytmusic.search(q);
        const filtered = results.filter(item => item.type === 'SONG' || item.type === 'VIDEO');
        res.json(filtered);
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Failed to search' });
    }
});

app.get('/api/external-info', async (req, res) => {
    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: 'Video ID is required' });

    for (const provider of PROVIDERS) {
        try {
            const response = await axios.get(provider.getUrl(videoId, API_KEY), { timeout: 10000 });
            const parsed = provider.parse(response.data);
            if (parsed) {
                return res.json({ status: true, ...parsed, thumbnail: parsed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` });
            }
        } catch (err) {
            console.error(`Provider ${provider.name} failed for external-info (Main Key):`, err.message);
        }
        
        if(BACKUP_API_KEY) {
            try {
                const response = await axios.get(provider.getUrl(videoId, BACKUP_API_KEY), { timeout: 10000 });
                const parsed = provider.parse(response.data);
                if (parsed) {
                    return res.json({ status: true, ...parsed, thumbnail: parsed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` });
                }
            } catch (err) {
                console.error(`Provider ${provider.name} failed for external-info (Backup Key):`, err.message);
            }
        }
    }
    res.status(500).json({ error: 'Failed to fetch external metadata from all providers' });
});

app.get('/api/download', checkDownloadLimit, async (req, res) => {
    const { v, url } = req.query;
    let targetUrl = url;

    if (v && !targetUrl) {
        targetUrl = `https://www.youtube.com/watch?v=${v}`;
    }

    if (!targetUrl) return res.status(400).json({ error: 'Video ID or URL is required' });

    if (targetUrl.includes('music.apple.com')) {
        let isSuccess = false;
        try {
            const response = await axios.get(`https://api.theresav.biz.id/download/applemusic?url=${encodeURIComponent(targetUrl)}&apikey=${API_KEY}`);
            if (response.data.status && response.data.result?.success) {
                isSuccess = true;
                const result = response.data.result;
                incrementDownloadCount(req.userIp);
                return res.json({
                    download_url: result.download.url,
                    title: result.metadata.title,
                    thumbnail: result.metadata.thumbnail,
                    channel: result.metadata.artist,
                    status: true
                });
            } else if (response.data.message && response.data.message.toLowerCase().includes('limit')) {
                // Limit reached, fallback will be used
            }
        } catch (err) {
            console.error(`Apple Music API failed:`, err.message);
        }

        if (!isSuccess && BACKUP_API_KEY) {
            try {
                const response = await axios.get(`https://api.theresav.biz.id/download/applemusic?url=${encodeURIComponent(targetUrl)}&apikey=${BACKUP_API_KEY}`);
                if (response.data.status && response.data.result?.success) {
                    const result = response.data.result;
                    incrementDownloadCount(req.userIp);
                    return res.json({
                        download_url: result.download.url,
                        title: result.metadata.title,
                        thumbnail: result.metadata.thumbnail,
                        channel: result.metadata.artist,
                        status: true
                    });
                } else if (response.data.message && response.data.message.toLowerCase().includes('limit')) {
                     return res.status(403).json({ error: 'API_LIMIT_REACHED', message: 'Limit Server Apple Music (Utama & Cadangan) telah habis hari ini.' });
                }
            } catch (err) {
                 console.error(`Apple Music API (Backup) failed:`, err.message);
                 if (err.response?.data?.message && err.response.data.message.toLowerCase().includes('limit')) {
                    return res.status(403).json({ error: 'API_LIMIT_REACHED', message: 'Limit Server Apple Music (Utama & Cadangan) telah habis hari ini.' });
                }
            }
        }
        
        if(!isSuccess) {
            return res.status(500).json({ error: 'Gagal memproses link dari Apple Music. Server kemungkinan sedang limit.' });
        }
    }

    const videoId = v || (targetUrl.match(/^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/)?.[1]);
    
    if (videoId && videoId.length === 11) {
        for (const provider of PROVIDERS) {
            let isSuccess = false;
            try {
                const response = await axios.get(provider.getUrl(videoId, API_KEY), { timeout: 15000 });
                const parsed = provider.parse(response.data);
                if (parsed) {
                    isSuccess = true;
                    incrementDownloadCount(req.userIp);
                    return res.json(parsed);
                }
            } catch (err) {
                console.error(`Download API error with ${provider.name} (Main Key):`, err.message);
            }

            if (!isSuccess && BACKUP_API_KEY) {
                try {
                    const response = await axios.get(provider.getUrl(videoId, BACKUP_API_KEY), { timeout: 15000 });
                    const parsed = provider.parse(response.data);
                    if (parsed) {
                        incrementDownloadCount(req.userIp);
                        return res.json(parsed);
                    }
                } catch (err) {
                    console.error(`Download API error with ${provider.name} (Backup Key):`, err.message);
                }
            }
        }
    }

    res.status(500).json({ error: 'Gagal memproses link dari semua server yang tersedia. Server kemungkinan sedang limit.' });
});

app.get('/api/url-info', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    if (url.includes('music.apple.com')) {
        try {
            const response = await axios.get(`https://api.theresav.biz.id/download/applemusic?url=${encodeURIComponent(url)}&apikey=${API_KEY}`);
            const data = response.data;
            if (data.status && data.result?.success) {
                const meta = data.result.metadata;
                return res.json({
                    videoId: `am-${Date.now()}`, 
                    name: meta.title || 'Unknown Title',
                    artist: { name: meta.artist || 'Unknown Artist' },
                    thumbnails: [{ url: meta.thumbnail, width: 1200, height: 630 }],
                    type: 'SONG',
                    isDirect: true,
                    externalData: {
                        download_url: data.result.download.url,
                        title: meta.title,
                        channel: meta.artist,
                        album: meta.album,
                        thumbnail: meta.thumbnail,
                        status: true
                    }
                });
            }
        } catch (err) {
            console.error(`Apple Music info failed:`, err.message);
        }
    }

    const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
    const match = url.match(regExp);
    const videoId = (match && match[1].length === 11) ? match[1] : null;

    if (videoId) {
        for (const provider of PROVIDERS) {
            try {
                const response = await axios.get(provider.getUrl(videoId), { timeout: 15000 });
                const parsed = provider.parse(response.data);
                if (parsed) {
                    return res.json({
                        videoId: videoId,
                        name: parsed.title || 'Unknown Title',
                        artist: { name: parsed.channel || 'Unknown Artist' },
                        thumbnails: [{ url: parsed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 1280, height: 720 }],
                        type: 'VIDEO',
                        isDirect: true,
                        externalData: { ...parsed, status: true }
                    });
                }
            } catch (err) {
                console.error(`YouTube url-info failed:`, err.message);
            }
        }
    }

    res.status(400).json({ error: 'Gagal mendapatkan informasi dari link tersebut' });
});

app.get('/api/proxy-download', async (req, res) => {
    const { url, filename, title, artist, image, album } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        // Handle nested/worker URLs (like worker03/iamworker)
        let finalDownloadUrl = url;
        try {
            // Use a quick HEAD or small GET to check if it's a JSON response
            const probe = await axios.get(url, { 
                timeout: 5000, 
                headers: { 'Range': 'bytes=0-512' },
                validateStatus: () => true 
            });
            
            const contentType = probe.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
                // If it's JSON, get the full body to check status
                const check = await axios.get(url, { timeout: 10000 });
                if (check.data?.status === 'completed' && check.data?.fileUrl) {
                    finalDownloadUrl = check.data.fileUrl;
                    console.log('Detected nested worker URL, using:', finalDownloadUrl);
                } else if (check.data?.status === 'processing' || check.data?.status === 'waiting') {
                    // If still processing, wait 3 seconds and try one more time
                    await new Promise(r => setTimeout(r, 3000));
                    const retry = await axios.get(url, { timeout: 10000 });
                    if (retry.data?.status === 'completed' && retry.data?.fileUrl) {
                        finalDownloadUrl = retry.data.fileUrl;
                    } else {
                        // Still not ready, return 202 Accepted so client knows to wait
                        return res.status(202).send('File is still being processed. Please try again in a few seconds.');
                    }
                }
            }
        } catch (e) {
            console.log('Probe failed, proceeding with original URL:', e.message);
        }

        const isMp3 = (filename && filename.toLowerCase().endsWith('.mp3')) || finalDownloadUrl.toLowerCase().includes('.mp3');
        const shouldTag = isMp3 && (title || artist || image);

        if (shouldTag) {
            const response = await axios({
                method: 'get',
                url: finalDownloadUrl,
                responseType: 'arraybuffer',
                timeout: 120000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': new URL(finalDownloadUrl).origin,
                    'Accept': '*/*'
                }
            });

            // Double check if we got a tiny file (likely a JSON error disguised as MP3)
            if (response.data.length < 100000) { // Less than 100KB is suspicious for a 320kbps MP3
                const contentType = response.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    return res.status(202).send('File is still being processed. Please try again.');
                }
            }

            let rawMp3Buffer = Buffer.from(response.data);
            let cleanMp3Buffer = NodeID3.removeTagsFromBuffer(rawMp3Buffer);
            if (!(cleanMp3Buffer instanceof Buffer)) {
                cleanMp3Buffer = rawMp3Buffer;
            }

            let finalArtworkBuffer = null;
            if (image) {
                try {
                    let finalImageUrl = image;
                    if (image.includes('mzstatic.com')) {
                        finalImageUrl = image.replace(/\/\d+x\d+bb\.jpg$/, '/800x800bb.jpg');
                    }

                    const imgResponse = await axios.get(finalImageUrl, { 
                        responseType: 'arraybuffer', 
                        timeout: 15000,
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                    });
                    
                    finalArtworkBuffer = await sharp(Buffer.from(imgResponse.data))
                        .trim()
                        .resize(512, 512, { fit: 'cover' })
                        .toFormat('jpeg', { quality: 85, progressive: false })
                        .toBuffer();
                } catch (imgErr) {
                    console.error('Artwork fetch failed:', imgErr.message);
                }
            }

            const tags = {
                title: (title || (filename ? filename.replace('.mp3', '') : 'Unknown Title')).substring(0, 200),
                artist: (artist || 'Unknown Artist').substring(0, 100),
                album: (album || title || (image && image.includes('mzstatic.com') ? 'Apple Music' : 'YouTube')).substring(0, 100),
                trackNumber: "1",
                partOfSet: "1"
            };

            if (finalArtworkBuffer) {
                tags.image = {
                    mime: 'image/jpeg',
                    type: { id: 3, name: 'front cover' },
                    description: 'Cover',
                    imageBuffer: finalArtworkBuffer
                };
            }

            const finalBuffer = NodeID3.write(tags, cleanMp3Buffer);
            const outputBuffer = (finalBuffer instanceof Buffer) ? finalBuffer : cleanMp3Buffer;

            const cleanFilename = (filename || 'audio.mp3').replace(/[/\\?%*:|"<>]/g, '-');
            const safeFilename = cleanFilename.replace(/[^\x20-\x7E]/g, '?'); 
            
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`);
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Length', outputBuffer.length);
            return res.end(outputBuffer);
        } else {
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 120000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': urlObj.origin,
                    'Accept': '*/*'
                }
            });

            const cleanFilename = (filename || 'file').replace(/[/\\?%*:|"<>]/g, '-');
            const safeFilename = cleanFilename.replace(/[^\x20-\x7E]/g, '?');
            const contentType = response.headers['content-type'] || 'application/octet-stream';
            
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`);
            res.setHeader('Content-Type', contentType);
            if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);

            response.data.pipe(res);
            response.data.on('error', (err) => {
                if (!res.headersSent) res.status(500).send('Error streaming file');
            });
        }

    } catch (err) {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) res.status(500).send(`Gagal mengunduh: ${err.message}`);
    }
});

// Error Handling for Uncaught Exceptions to prevent crash
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

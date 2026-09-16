const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com'
]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

class DownloadPolicyError extends Error {
    constructor(code, message, statusCode) {
        super(message);
        this.name = 'DownloadPolicyError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function videoUrlFromId(videoId) {
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
        throw new DownloadPolicyError('INVALID_VIDEO_ID', 'Video ID YouTube tidak valid.', 400);
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeYouTubeUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) {
        throw new DownloadPolicyError('INVALID_YOUTUBE_URL', 'URL YouTube tidak valid.', 400);
    }

    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new DownloadPolicyError('INVALID_YOUTUBE_URL', 'URL YouTube tidak valid.', 400);
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        throw new DownloadPolicyError('INVALID_YOUTUBE_URL', 'URL harus memakai HTTPS.', 400);
    }

    let videoId;
    if (parsed.hostname === 'youtu.be') {
        videoId = parsed.pathname.split('/').filter(Boolean)[0];
    } else if (YOUTUBE_HOSTS.has(parsed.hostname)) {
        if (parsed.pathname === '/watch') {
            videoId = parsed.searchParams.get('v');
        } else {
            const [kind, id] = parsed.pathname.split('/').filter(Boolean);
            if (['embed', 'live', 'shorts'].includes(kind)) videoId = id;
        }
    }

    try {
        return videoUrlFromId(videoId);
    } catch {
        throw new DownloadPolicyError('INVALID_YOUTUBE_URL', 'URL YouTube tidak valid atau tidak didukung.', 400);
    }
}

class DownloadGate {
    constructor({ maxActive, maxQueued }) {
        this.maxActive = maxActive;
        this.maxQueued = maxQueued;
        this.active = 0;
        this.queue = [];
        this.clients = new Set();
    }

    run(clientId, task) {
        if (this.clients.has(clientId)) {
            return Promise.reject(new DownloadPolicyError(
                'DOWNLOAD_ALREADY_ACTIVE',
                'Satu unduhan untuk IP ini masih diproses.',
                429
            ));
        }
        if (this.active >= this.maxActive && this.queue.length >= this.maxQueued) {
            return Promise.reject(new DownloadPolicyError(
                'DOWNLOAD_QUEUE_FULL',
                'Antrean unduhan sedang penuh. Coba lagi beberapa saat lagi.',
                503
            ));
        }

        this.clients.add(clientId);
        return new Promise((resolve, reject) => {
            const item = { clientId, task, resolve, reject };
            if (this.active < this.maxActive) this.#start(item);
            else this.queue.push(item);
        });
    }

    #start(item) {
        this.active += 1;
        Promise.resolve()
            .then(item.task)
            .then(item.resolve, item.reject)
            .finally(() => {
                this.active -= 1;
                this.clients.delete(item.clientId);
                const next = this.queue.shift();
                if (next) this.#start(next);
            });
    }
}

module.exports = {
    DownloadGate,
    DownloadPolicyError,
    normalizeYouTubeUrl,
    videoUrlFromId
};

const { randomUUID } = require('node:crypto');
const { DownloadPolicyError } = require('./download-policy');

const STAGE_MESSAGES = {
    queued: 'Menunggu antrean...',
    metadata: 'Mengambil metadata...',
    downloading: 'Mengunduh audio...',
    encoding: 'Mengubah format audio...',
    tagging: 'Menambahkan metadata...',
    completed: 'File siap diunduh.',
    failed: 'Unduhan gagal.',
    cancelled: 'Unduhan dibatalkan.'
};
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

class DownloadJobManager {
    constructor({ maxActive, maxQueued, ttlMs, runner, cleanupResult = () => {}, now = Date.now }) {
        this.maxActive = maxActive;
        this.maxQueued = maxQueued;
        this.ttlMs = ttlMs;
        this.runner = runner;
        this.cleanupResult = cleanupResult;
        this.now = now;
        this.active = 0;
        this.jobs = new Map();
        this.queue = [];
        this.clients = new Set();
        this.cleanupTimer = setInterval(
            () => this.cleanupExpired(),
            Math.max(1000, Math.min(ttlMs, 60_000))
        );
        this.cleanupTimer.unref?.();
    }

    create({ clientId, url, options }) {
        if (this.clients.has(clientId)) {
            throw new DownloadPolicyError(
                'DOWNLOAD_ALREADY_ACTIVE',
                'Satu unduhan untuk IP ini masih diproses.',
                429
            );
        }
        if (this.active >= this.maxActive && this.queue.length >= this.maxQueued) {
            throw new DownloadPolicyError(
                'DOWNLOAD_QUEUE_FULL',
                'Antrean unduhan sedang penuh. Coba lagi beberapa saat lagi.',
                503
            );
        }

        const timestamp = this.now();
        const job = {
            id: randomUUID(),
            clientId,
            url,
            options: { ...options },
            status: 'queued',
            stage: 'queued',
            progress: 0,
            error: null,
            result: null,
            controller: null,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        this.jobs.set(job.id, job);
        this.clients.add(clientId);
        this.queue.push(job);
        queueMicrotask(() => this.#pump());
        return this.#public(job);
    }

    getPublic(id) {
        return this.#public(this.#find(id));
    }

    cancel(id) {
        const job = this.#find(id);
        if (TERMINAL_STATUSES.has(job.status)) {
            throw new DownloadPolicyError(
                'JOB_NOT_CANCELLABLE',
                'Job ini tidak dapat dibatalkan.',
                409
            );
        }

        if (job.status === 'queued') {
            this.queue = this.queue.filter(candidate => candidate.id !== job.id);
        }
        job.status = 'cancelled';
        job.stage = 'cancelled';
        job.error = null;
        job.updatedAt = this.now();
        this.clients.delete(job.clientId);
        job.controller?.abort();
        return this.#public(job);
    }

    retry(id, clientId) {
        const job = this.#find(id);
        if (!['failed', 'cancelled'].includes(job.status)) {
            throw new DownloadPolicyError(
                'JOB_NOT_RETRYABLE',
                'Job ini belum dapat dicoba ulang.',
                409
            );
        }
        return this.create({
            clientId,
            url: job.url,
            options: job.options
        });
    }

    consume(id) {
        const job = this.#find(id);
        if (job.status !== 'completed' || !job.result) {
            throw new DownloadPolicyError('JOB_NOT_READY', 'File belum siap diunduh.', 409);
        }
        return { ...job.result };
    }

    remove(id) {
        const job = this.jobs.get(id);
        if (!job) return;
        if (!TERMINAL_STATUSES.has(job.status)) this.cancel(id);
        if (job.result) this.cleanupResult(job.result);
        this.jobs.delete(id);
    }

    cleanupExpired() {
        const timestamp = this.now();
        for (const job of this.jobs.values()) {
            if (TERMINAL_STATUSES.has(job.status) && timestamp - job.updatedAt >= this.ttlMs) {
                this.remove(job.id);
            }
        }
    }

    stats() {
        return {
            active: this.active,
            queued: this.queue.length,
            maxActive: this.maxActive,
            maxQueued: this.maxQueued
        };
    }

    close() {
        clearInterval(this.cleanupTimer);
        for (const job of [...this.jobs.values()]) {
            if (!TERMINAL_STATUSES.has(job.status)) {
                try {
                    this.cancel(job.id);
                } catch {}
            }
        }
    }

    #find(id) {
        const job = this.jobs.get(id);
        if (!job) {
            throw new DownloadPolicyError('JOB_NOT_FOUND', 'Job unduhan tidak ditemukan.', 404);
        }
        return job;
    }

    #pump() {
        while (this.active < this.maxActive && this.queue.length > 0) {
            const job = this.queue.shift();
            if (job.status !== 'queued') continue;
            this.#start(job);
        }
    }

    #start(job) {
        this.active += 1;
        job.status = 'running';
        job.stage = 'metadata';
        job.progress = Math.max(job.progress, 2);
        job.updatedAt = this.now();
        job.controller = new AbortController();

        Promise.resolve()
            .then(() => this.runner(
                {
                    id: job.id,
                    url: job.url,
                    options: { ...job.options }
                },
                job.controller.signal,
                update => this.#updateProgress(job, update)
            ))
            .then(result => {
                if (job.status === 'cancelled') {
                    this.cleanupResult(result);
                    return;
                }
                job.result = result;
                job.status = 'completed';
                job.stage = 'completed';
                job.progress = 100;
                job.updatedAt = this.now();
                this.clients.delete(job.clientId);
            })
            .catch(error => {
                if (job.status === 'cancelled' || error?.name === 'AbortError') return;
                job.status = 'failed';
                job.stage = 'failed';
                job.error = {
                    code: error?.code === 'DOWNLOAD_TIMEOUT' ? 'DOWNLOAD_TIMEOUT' : 'DOWNLOAD_FAILED',
                    message: error?.code === 'DOWNLOAD_TIMEOUT'
                        ? 'Proses unduhan melewati batas waktu.'
                        : 'Gagal mengunduh audio.'
                };
                job.updatedAt = this.now();
                this.clients.delete(job.clientId);
            })
            .finally(() => {
                job.controller = null;
                this.active -= 1;
                this.#pump();
            });
    }

    #updateProgress(job, update) {
        if (job.status !== 'running' || !update || !(update.stage in STAGE_MESSAGES)) return;
        const progress = Number(update.progress);
        if (!Number.isFinite(progress)) return;
        job.stage = update.stage;
        job.progress = Math.max(job.progress, Math.max(0, Math.min(99, Math.round(progress))));
        job.updatedAt = this.now();
    }

    #public(job) {
        return {
            id: job.id,
            status: job.status,
            stage: job.stage,
            progress: job.progress,
            message: STAGE_MESSAGES[job.stage],
            fileName: job.result?.fileName || null,
            fileSize: job.result?.fileSize ?? null,
            outputFormat: job.result?.outputFormat || job.options.format,
            bitrate: job.options.bitrate,
            error: job.error ? { ...job.error } : null
        };
    }
}

module.exports = { DownloadJobManager };

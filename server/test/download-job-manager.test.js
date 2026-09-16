const test = require('node:test');
const assert = require('node:assert/strict');

const { DownloadJobManager } = require('../lib/download-job-manager');

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const OPTIONS = { format: 'mp3', bitrate: 192 };

function input(clientId = 'client-a') {
    return { clientId, url: URL, options: OPTIONS };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function waitFor(check) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const value = check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for job state');
}

test('completes a job and never lets reported progress move backwards', async () => {
    const finish = deferred();
    const manager = new DownloadJobManager({
        maxActive: 1,
        maxQueued: 1,
        ttlMs: 1000,
        runner: async (_job, _signal, onProgress) => {
            onProgress({ stage: 'downloading', progress: 50 });
            onProgress({ stage: 'downloading', progress: 40 });
            await finish.promise;
            return {
                filePath: '/safe/song.mp3',
                fileName: 'song.mp3',
                fileSize: 3,
                outputFormat: 'mp3'
            };
        }
    });

    const created = manager.create(input());
    await waitFor(() => manager.getPublic(created.id).progress === 50);
    assert.equal(manager.getPublic(created.id).progress, 50);
    finish.resolve();
    const completed = await waitFor(() => {
        const job = manager.getPublic(created.id);
        return job.status === 'completed' ? job : null;
    });

    assert.equal(completed.progress, 100);
    assert.equal(completed.fileName, 'song.mp3');
    assert.equal(completed.fileSize, 3);
    assert.equal(completed.outputFormat, 'mp3');
    assert.equal('url' in completed, false);
    assert.equal('clientId' in completed, false);
    assert.equal('filePath' in completed, false);
    manager.close();
});

test('enforces global queue capacity and one unfinished job per client', async () => {
    const firstRun = deferred();
    const manager = new DownloadJobManager({
        maxActive: 1,
        maxQueued: 1,
        ttlMs: 1000,
        runner: () => firstRun.promise
    });

    const first = manager.create(input('client-a'));
    await waitFor(() => manager.getPublic(first.id).status === 'running');
    assert.throws(
        () => manager.create(input('client-a')),
        error => error.code === 'DOWNLOAD_ALREADY_ACTIVE' && error.statusCode === 429
    );

    manager.create(input('client-b'));
    assert.throws(
        () => manager.create(input('client-c')),
        error => error.code === 'DOWNLOAD_QUEUE_FULL' && error.statusCode === 503
    );

    firstRun.resolve({ filePath: '/safe/a.mp3', fileName: 'a.mp3', fileSize: 1, outputFormat: 'mp3' });
    manager.close();
});

test('cancels queued and running jobs and allows a cancelled job to retry', async () => {
    const runs = [];
    const manager = new DownloadJobManager({
        maxActive: 1,
        maxQueued: 2,
        ttlMs: 1000,
        runner: (_job, signal) => new Promise((resolve, reject) => {
            runs.push({ resolve, reject });
            signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        })
    });

    const running = manager.create(input('client-a'));
    await waitFor(() => manager.getPublic(running.id).status === 'running');
    const queued = manager.create(input('client-b'));

    assert.equal(manager.cancel(queued.id).status, 'cancelled');
    assert.equal(manager.cancel(running.id).status, 'cancelled');

    const retried = manager.retry(running.id, 'client-a');
    assert.notEqual(retried.id, running.id);
    assert.equal(retried.status, 'queued');
    manager.cancel(retried.id);
    manager.close();
});

test('expires terminal jobs and cleans their result directory', async () => {
    let now = 1000;
    const cleaned = [];
    const manager = new DownloadJobManager({
        maxActive: 1,
        maxQueued: 0,
        ttlMs: 50,
        now: () => now,
        cleanupResult: result => cleaned.push(result.jobDir),
        runner: async () => ({
            filePath: '/safe/a.mp3',
            fileName: 'a.mp3',
            fileSize: 1,
            outputFormat: 'mp3',
            jobDir: '/safe/job-a'
        })
    });

    const created = manager.create(input());
    await waitFor(() => manager.getPublic(created.id).status === 'completed');
    now = 1100;
    manager.cleanupExpired();

    assert.throws(
        () => manager.getPublic(created.id),
        error => error.code === 'JOB_NOT_FOUND' && error.statusCode === 404
    );
    assert.deepEqual(cleaned, ['/safe/job-a']);
    manager.close();
});

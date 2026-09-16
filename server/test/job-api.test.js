const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitUntilReady(baseUrl, child) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
        try {
            const response = await fetch(`${baseUrl}/robots.txt`);
            if (response.ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Server did not become ready');
}

async function pollJob(baseUrl, id, expectedStatus) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const response = await fetch(`${baseUrl}/api/jobs/${id}`);
        assert.equal(response.status, 200);
        const job = await response.json();
        if (job.status === expectedStatus) return job;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Job ${id} did not reach ${expectedStatus}`);
}

function youtubeUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

async function createJob(baseUrl, body) {
    return fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

test('job API completes files, supports Fast Mode, cancel and retry, and exposes health', { timeout: 15000 }, async () => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const fixturePath = path.join(__dirname, 'fixtures', 'fake-engine.js');
    const child = spawn(process.execPath, ['index.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            TRUST_PROXY_HOPS: '0',
            PYTHON_BIN: process.execPath,
            ENGINE_SCRIPT_PATH: fixturePath,
            HEALTHCHECK_BINARIES: 'false',
            MAX_ACTIVE_DOWNLOADS: '1',
            MAX_QUEUED_DOWNLOADS: '2'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        await waitUntilReady(baseUrl, child);

        const healthResponse = await fetch(`${baseUrl}/api/health`);
        assert.equal(healthResponse.status, 200);
        const health = await healthResponse.json();
        assert.equal(health.status, 'ok');
        assert.equal(health.checks.outputDirectory, true);
        assert.equal(health.queue.maxActive, 1);

        const invalid = await createJob(baseUrl, {
            url: youtubeUrl('aaaaaaaaaaa'),
            format: 'flac',
            bitrate: 999
        });
        assert.equal(invalid.status, 400);
        assert.equal((await invalid.json()).error, 'INVALID_OUTPUT_OPTIONS');

        const mp3Response = await createJob(baseUrl, {
            url: youtubeUrl('aaaaaaaaaaa'),
            format: 'mp3',
            bitrate: 192
        });
        assert.equal(mp3Response.status, 202);
        const mp3Created = await mp3Response.json();
        const mp3 = await pollJob(baseUrl, mp3Created.id, 'completed');
        assert.equal(mp3.progress, 100);
        assert.equal(mp3.fileSize, 3);
        assert.equal(mp3.outputFormat, 'mp3');
        for (const privateKey of ['url', 'clientId', 'filePath', 'stderr']) {
            assert.equal(privateKey in mp3, false);
        }

        const mp3File = await fetch(`${baseUrl}/api/jobs/${mp3.id}/file`);
        assert.equal(mp3File.status, 200);
        assert.equal(await mp3File.text(), 'abc');

        const originalResponse = await createJob(baseUrl, {
            url: youtubeUrl('ddddddddddd'),
            format: 'original'
        });
        assert.equal(originalResponse.status, 202);
        const originalCreated = await originalResponse.json();
        const original = await pollJob(baseUrl, originalCreated.id, 'completed');
        assert.equal(original.outputFormat, 'm4a');
        assert.equal(original.bitrate, null);
        const originalFile = await fetch(`${baseUrl}/api/jobs/${original.id}/file`);
        assert.equal(originalFile.status, 200);
        assert.equal(await originalFile.text(), 'abc');

        const blockedResponse = await createJob(baseUrl, {
            url: youtubeUrl('bbbbbbbbbbb'),
            format: 'mp3',
            bitrate: 128
        });
        const blocked = await blockedResponse.json();
        await pollJob(baseUrl, blocked.id, 'running');
        const cancelledResponse = await fetch(`${baseUrl}/api/jobs/${blocked.id}`, { method: 'DELETE' });
        assert.equal(cancelledResponse.status, 202);
        assert.equal((await cancelledResponse.json()).status, 'cancelled');

        const retriedResponse = await fetch(`${baseUrl}/api/jobs/${blocked.id}/retry`, { method: 'POST' });
        assert.equal(retriedResponse.status, 202);
        const retried = await retriedResponse.json();
        assert.notEqual(retried.id, blocked.id);
        await pollJob(baseUrl, retried.id, 'running');
        await fetch(`${baseUrl}/api/jobs/${retried.id}`, { method: 'DELETE' });

        const unknown = await fetch(`${baseUrl}/api/jobs/550e8400-e29b-41d4-a716-446655440000`);
        assert.equal(unknown.status, 404);
        assert.equal((await unknown.json()).error, 'JOB_NOT_FOUND');
    } finally {
        child.kill('SIGTERM');
        await new Promise(resolve => child.once('exit', resolve));
    }
});

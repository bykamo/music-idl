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
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
        try {
            const response = await fetch(`${baseUrl}/robots.txt`);
            if (response.ok) return response;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Server did not become ready');
}

test('HTTP boundary rejects unsafe URLs and does not expose an open proxy', { timeout: 10000 }, async () => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['index.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
        const readyResponse = await waitUntilReady(baseUrl, child);
        assert.equal(readyResponse.headers.get('x-content-type-options'), 'nosniff');

        const invalidDownload = await fetch(
            `${baseUrl}/api/engine-download?url=${encodeURIComponent('https://example.com/audio')}`
        );
        assert.equal(invalidDownload.status, 400);
        assert.equal((await invalidDownload.json()).error, 'INVALID_YOUTUBE_URL');

        const appleSearch = await fetch(
            `${baseUrl}/api/search?q=${encodeURIComponent('https://music.apple.com/id/album/example/1')}`
        );
        assert.equal(appleSearch.status, 400);
        assert.equal((await appleSearch.json()).error, 'UNSUPPORTED_URL');

        const formerProxy = await fetch(
            `${baseUrl}/api/proxy-download?url=${encodeURIComponent(`${baseUrl}/robots.txt`)}`
        );
        assert.equal(formerProxy.status, 404);
    } finally {
        child.kill('SIGTERM');
        await new Promise(resolve => child.once('exit', resolve));
    }
});

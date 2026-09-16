const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DownloadGate,
    normalizeYouTubeUrl,
    videoUrlFromId
} = require('../lib/download-policy');

test('normalizeYouTubeUrl canonicalizes supported YouTube links and removes tracking parameters', () => {
    assert.equal(
        normalizeYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=tracking'),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.equal(
        normalizeYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=private'),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.equal(
        normalizeYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
});

test('normalizeYouTubeUrl rejects non-HTTPS, lookalike, private, and unsupported URLs', () => {
    for (const value of [
        'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
        'http://127.0.0.1:5200/private',
        'https://music.apple.com/id/album/example/1',
        'not-a-url'
    ]) {
        assert.throws(
            () => normalizeYouTubeUrl(value),
            error => error.code === 'INVALID_YOUTUBE_URL' && error.statusCode === 400
        );
    }
});

test('videoUrlFromId accepts only an exact YouTube video id', () => {
    assert.equal(
        videoUrlFromId('dQw4w9WgXcQ'),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    assert.throws(
        () => videoUrlFromId('dQw4w9WgXcQ&list=private'),
        error => error.code === 'INVALID_VIDEO_ID' && error.statusCode === 400
    );
});

test('DownloadGate limits global work, queues briefly, and rejects duplicate clients', async () => {
    const gate = new DownloadGate({ maxActive: 1, maxQueued: 1 });
    let finishFirst;
    const first = gate.run('client-a', () => new Promise(resolve => {
        finishFirst = resolve;
    }));

    await assert.rejects(
        gate.run('client-a', async () => 'duplicate'),
        error => error.code === 'DOWNLOAD_ALREADY_ACTIVE' && error.statusCode === 429
    );

    let secondStarted = false;
    const second = gate.run('client-b', async () => {
        secondStarted = true;
        return 'second';
    });
    await Promise.resolve();
    assert.equal(secondStarted, false);

    await assert.rejects(
        gate.run('client-c', async () => 'overflow'),
        error => error.code === 'DOWNLOAD_QUEUE_FULL' && error.statusCode === 503
    );

    finishFirst('first');
    assert.equal(await first, 'first');
    assert.equal(await second, 'second');
    assert.equal(secondStarted, true);
});

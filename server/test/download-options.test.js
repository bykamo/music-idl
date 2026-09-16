const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    allowedAudioPath,
    normalizeDownloadOptions
} = require('../lib/download-options');

test('normalizes supported download options with a safe MP3 default', () => {
    assert.deepEqual(normalizeDownloadOptions(), { format: 'mp3', bitrate: 192 });
    assert.deepEqual(
        normalizeDownloadOptions({ format: 'mp3', bitrate: 320 }),
        { format: 'mp3', bitrate: 320 }
    );
    assert.deepEqual(
        normalizeDownloadOptions({ format: 'original', bitrate: 128 }),
        { format: 'original', bitrate: null }
    );
});

test('rejects unsupported output formats and MP3 bitrates', () => {
    for (const value of [
        { format: 'flac' },
        { format: 'mp3', bitrate: 256 },
        { format: 'mp3', bitrate: '320' }
    ]) {
        assert.throws(
            () => normalizeDownloadOptions(value),
            error => error.code === 'INVALID_OUTPUT_OPTIONS' && error.statusCode === 400
        );
    }
});

test('allows only supported audio files contained by the job directory', () => {
    const jobDir = path.resolve('/tmp/music-idl-job');
    assert.equal(allowedAudioPath(jobDir, path.join(jobDir, 'song.mp3')), true);
    assert.equal(allowedAudioPath(jobDir, path.join(jobDir, 'song.m4a')), true);
    assert.equal(allowedAudioPath(jobDir, path.join(jobDir, 'song.webm')), true);
    assert.equal(allowedAudioPath(jobDir, path.join(jobDir, 'song.opus')), true);
    assert.equal(allowedAudioPath(jobDir, path.join(jobDir, 'song.exe')), false);
    assert.equal(allowedAudioPath(jobDir, path.resolve(jobDir, '..', 'song.mp3')), false);
});

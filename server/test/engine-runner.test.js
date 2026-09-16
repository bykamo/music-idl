const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEngineRunner, parseEngineEvent } = require('../lib/engine-runner');

const fixturePath = path.join(__dirname, 'fixtures', 'fake-engine.js');

function youtubeUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

test('parses only valid structured engine events', () => {
    assert.deepEqual(
        parseEngineEvent('MUSIC_IDL_EVENT {"stage":"downloading","progress":42}'),
        { stage: 'downloading', progress: 42 }
    );
    assert.equal(parseEngineEvent('ordinary stderr'), null);
    assert.equal(parseEngineEvent('MUSIC_IDL_EVENT not-json'), null);
    assert.equal(parseEngineEvent('MUSIC_IDL_EVENT {"stage":"hacked","progress":42}'), null);
});

test('streams progress and returns validated MP3 and original audio results', async t => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-idl-runner-'));
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
    const run = createEngineRunner({
        binary: process.execPath,
        scriptPath: fixturePath,
        cwd: path.join(__dirname, '..'),
        env: process.env,
        timeoutMs: 2000,
        outputDir
    });
    const events = [];

    const mp3 = await run({
        url: youtubeUrl('aaaaaaaaaaa'),
        options: { format: 'mp3', bitrate: 192 }
    }, new AbortController().signal, event => events.push(event));
    const original = await run({
        url: youtubeUrl('ddddddddddd'),
        options: { format: 'original', bitrate: null }
    }, new AbortController().signal, () => {});

    assert.deepEqual(events, [
        { stage: 'metadata', progress: 2 },
        { stage: 'downloading', progress: 62 }
    ]);
    assert.equal(mp3.fileName, 'fixture [aaaaaaaaaaa].mp3');
    assert.equal(mp3.fileSize, 3);
    assert.equal(mp3.outputFormat, 'mp3');
    assert.equal(original.outputFormat, 'm4a');
});

test('rejects failed and aborted engine processes and removes partial directories', async t => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-idl-runner-'));
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
    const run = createEngineRunner({
        binary: process.execPath,
        scriptPath: fixturePath,
        cwd: path.join(__dirname, '..'),
        env: process.env,
        timeoutMs: 2000,
        outputDir
    });

    await assert.rejects(
        run({
            url: youtubeUrl('ccccccccccc'),
            options: { format: 'mp3', bitrate: 192 }
        }, new AbortController().signal, () => {}),
        /engine/i
    );

    const controller = new AbortController();
    let markStarted;
    const started = new Promise(resolve => {
        markStarted = resolve;
    });
    const blocked = run({
        url: youtubeUrl('bbbbbbbbbbb'),
        options: { format: 'mp3', bitrate: 192 }
    }, controller.signal, () => markStarted());
    const rejected = assert.rejects(blocked, error => error.name === 'AbortError');
    await started;
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(fs.readdirSync(outputDir), []);
    await rejected;
    assert.deepEqual(fs.readdirSync(outputDir), []);
});

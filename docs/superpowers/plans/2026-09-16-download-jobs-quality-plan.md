# Download Jobs and Quality Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build asynchronous download jobs with real progress, cancel, retry, health checks, MP3 quality selection, and an original-audio Fast Mode.

**Architecture:** A focused in-memory `DownloadJobManager` owns queueing and lifecycle state, while a streaming engine runner translates Python progress events into job updates. Express exposes the job API and React polls it; Python accepts allowlisted output options and emits structured progress without adding dependencies.

**Tech Stack:** Node.js 22 test runner, Express 5, React 19, TypeScript 6, Python 3, yt-dlp, FFmpeg.

**Spec:** `docs/superpowers/specs/2026-09-16-download-jobs-design.md`

## Global Constraints

- Keep the server single-process and in-memory; do not add Redis, BullMQ, a database, or a new package.
- Accept only YouTube HTTPS URLs already allowed by `normalizeYouTubeUrl`.
- Accept only output format `mp3` or `original`, and MP3 bitrate `128`, `192`, or `320`.
- Default MP3 bitrate is `192`; Fast Mode does not transcode and does not claim lossless quality.
- Never expose source URL, client IP, filesystem path, command arguments, or raw stderr in public job JSON.
- Preserve the existing direct endpoint temporarily, but migrate the client to the job API.
- Use test-first development for every production behavior.

---

### Task 1: Output option policy and Python engine modes

**Files:**
- Create: `server/lib/download-options.js`
- Modify: `server/engine/music_dl.py`
- Modify: `server/engine/test_music_dl.py`
- Test: `server/test/download-options.test.js`

**Interfaces:**
- Produces: `normalizeDownloadOptions(value) -> { format, bitrate }` and `allowedAudioPath(jobDir, filePath) -> boolean`.
- Produces: Python CLI `music_dl.py URL OUTPUT_DIR --format mp3|original [--bitrate 128|192|320]`.
- Produces: Python stderr events prefixed by `MUSIC_IDL_EVENT ` and stdout final JSON containing `file_path`, `format`, `bitrate`, and `file_size`.

- [ ] **Step 1: Write failing Node policy tests**

```js
test('normalizes supported download options', () => {
    assert.deepEqual(normalizeDownloadOptions({ format: 'mp3', bitrate: 320 }), {
        format: 'mp3', bitrate: 320
    });
    assert.deepEqual(normalizeDownloadOptions({ format: 'original' }), {
        format: 'original', bitrate: null
    });
});

test('rejects unsupported format and bitrate', () => {
    assert.throws(() => normalizeDownloadOptions({ format: 'flac' }), /format/i);
    assert.throws(() => normalizeDownloadOptions({ format: 'mp3', bitrate: 256 }), /bitrate/i);
});
```

- [ ] **Step 2: Run policy tests and confirm RED**

Run: `npm --prefix server test -- test/download-options.test.js`
Expected: FAIL because `server/lib/download-options.js` does not exist.

- [ ] **Step 3: Implement the allowlist policy**

```js
const MP3_BITRATES = new Set([128, 192, 320]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.webm', '.opus']);

function normalizeDownloadOptions(value = {}) {
    const format = value.format || 'mp3';
    if (format === 'original') return { format, bitrate: null };
    const bitrate = value.bitrate === undefined ? 192 : Number(value.bitrate);
    if (format !== 'mp3' || !MP3_BITRATES.has(bitrate)) {
        throw new DownloadPolicyError('INVALID_OUTPUT_OPTIONS', 'Format atau bitrate tidak didukung.', 400);
    }
    return { format, bitrate };
}
```

- [ ] **Step 4: Write failing Python engine-option tests**

```python
def test_original_mode_has_no_audio_postprocessor(self):
    options = music_dl.build_ydl_options('/tmp/output', 'original', None)
    self.assertEqual(options['format'], 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio')
    self.assertNotIn('postprocessors', options)

def test_mp3_mode_uses_requested_bitrate(self):
    options = music_dl.build_ydl_options('/tmp/output', 'mp3', 128)
    self.assertEqual(options['postprocessors'][0]['preferredquality'], '128')
```

- [ ] **Step 5: Run Python tests and confirm RED**

Run: `npm --prefix server run test:engine`
Expected: FAIL because `build_ydl_options` does not accept format and bitrate.

- [ ] **Step 6: Implement CLI parsing, structured hooks, and result metadata**

Use `argparse` with exact choices, add `emit_event(stage, progress)`, add yt-dlp `progress_hooks` and MP3-only `postprocessor_hooks`, skip artwork/tagging for original mode, locate only `.m4a`, `.webm`, or `.opus` in original mode, and return `os.path.getsize(mp3_path)` as `file_size`.

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run: `npm --prefix server test -- test/download-options.test.js`
Run: `npm --prefix server run test:engine`
Expected: all focused tests PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add server/lib/download-options.js server/test/download-options.test.js server/engine/music_dl.py server/engine/test_music_dl.py
git commit -m "feat: add audio output modes"
```

### Task 2: In-memory download job manager

**Files:**
- Create: `server/lib/download-job-manager.js`
- Create: `server/test/download-job-manager.test.js`

**Interfaces:**
- Consumes: `normalizeDownloadOptions` output and an injected `runner(job, signal, onProgress)` function.
- Produces: `create`, `getPublic`, `cancel`, `retry`, `consume`, `stats`, `cleanupExpired`, and `close` methods.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test('queues work, exposes monotonic progress, and completes', async () => {
    const manager = new DownloadJobManager({
        maxActive: 1,
        maxQueued: 1,
        ttlMs: 1000,
        runner: async (_job, _signal, progress) => {
            progress({ stage: 'downloading', progress: 50 });
            progress({ stage: 'downloading', progress: 40 });
            return { filePath: '/safe/a.mp3', fileName: 'a.mp3', fileSize: 3 };
        }
    });
    const job = manager.create({ clientId: 'a', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', options: { format: 'mp3', bitrate: 192 } });
    await manager.waitForIdle();
    assert.equal(manager.getPublic(job.id).status, 'completed');
    assert.equal(manager.getPublic(job.id).progress, 100);
});
```

- [ ] **Step 2: Run manager tests and confirm RED**

Run: `npm --prefix server test -- test/download-job-manager.test.js`
Expected: FAIL because the manager module does not exist.

- [ ] **Step 3: Implement minimal queue and lifecycle state**

Use `crypto.randomUUID()`, `Map`, an array queue, `AbortController`, fixed public messages, and terminal statuses. Remove queued cancellation immediately; abort running jobs; release client ownership on every terminal transition; copy URL/options internally on retry; never include them in `getPublic`.

- [ ] **Step 4: Add failing cancel, retry, capacity, and TTL tests**

```js
test('cancels a running job and permits retry', async () => {
    const manager = makeBlockingManager();
    const first = manager.create(validInput('client-a'));
    await manager.waitForStatus(first.id, 'running');
    assert.equal(manager.cancel(first.id).status, 'cancelled');
    const retried = manager.retry(first.id, 'client-a');
    assert.notEqual(retried.id, first.id);
});
```

- [ ] **Step 5: Run tests, implement missing transitions, and confirm GREEN**

Run: `npm --prefix server test -- test/download-job-manager.test.js`
Expected: all manager tests PASS with no unhandled rejection.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/lib/download-job-manager.js server/test/download-job-manager.test.js
git commit -m "feat: add in-memory download jobs"
```

### Task 3: Streaming engine runner

**Files:**
- Create: `server/lib/engine-runner.js`
- Create: `server/test/fixtures/fake-engine.js`
- Create: `server/test/engine-runner.test.js`

**Interfaces:**
- Consumes: `{ pythonBin, scriptPath, cwd, env, timeoutMs, outputDir }` configuration.
- Produces: `createEngineRunner(config)` returning `run(job, signal, onProgress)`.
- Produces: `parseEngineEvent(line) -> { stage, progress } | null`.

- [ ] **Step 1: Write failing event parser and runner tests**

```js
test('parses only valid prefixed progress events', () => {
    assert.deepEqual(parseEngineEvent('MUSIC_IDL_EVENT {"stage":"downloading","progress":42}'), {
        stage: 'downloading', progress: 42
    });
    assert.equal(parseEngineEvent('ordinary stderr'), null);
});
```

- [ ] **Step 2: Run runner tests and confirm RED**

Run: `npm --prefix server test -- test/engine-runner.test.js`
Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement streaming spawn runner**

Spawn the configured binary with an argument array only, split stderr by newline, cap stdout/stderr at 5 MiB, enforce timeout, map abort to an `AbortError`, parse the final stdout JSON, and validate the resolved output path with `allowedAudioPath(jobDir, filePath)` before returning it.

- [ ] **Step 4: Implement deterministic fake engine modes**

The fixture reads the video ID: `aaaaaaaaaaa` emits two progress events and an MP3 result; `bbbbbbbbbbb` waits until SIGTERM; `ccccccccccc` exits non-zero; `ddddddddddd` emits an M4A result. It writes only inside the provided output directory.

- [ ] **Step 5: Run runner tests and confirm GREEN**

Run: `npm --prefix server test -- test/engine-runner.test.js`
Expected: progress streams, MP3/M4A results validate, failure rejects, and abort kills the fixture.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/lib/engine-runner.js server/test/engine-runner.test.js server/test/fixtures/fake-engine.js
git commit -m "feat: stream download engine progress"
```

### Task 4: Express job API and health check

**Files:**
- Modify: `server/index.js`
- Modify: `server/.env.example`
- Create: `server/test/job-api.test.js`
- Modify: `server/test/http-security.test.js`

**Interfaces:**
- Consumes: output policy, job manager, and engine runner.
- Produces: `POST /api/jobs`, `GET /api/jobs/:id`, `DELETE /api/jobs/:id`, `POST /api/jobs/:id/retry`, `GET /api/jobs/:id/file`, and `GET /api/health`.

- [ ] **Step 1: Write failing HTTP integration test**

```js
const created = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: youtubeUrl('aaaaaaaaaaa'), format: 'mp3', bitrate: 192 })
});
assert.equal(created.status, 202);
const job = await created.json();
const completed = await pollJob(baseUrl, job.id, 'completed');
assert.equal(completed.fileSize, 3);
const file = await fetch(`${baseUrl}/api/jobs/${job.id}/file`);
assert.equal(file.status, 200);
```

- [ ] **Step 2: Run API test and confirm RED**

Run: `npm --prefix server test -- test/job-api.test.js`
Expected: FAIL with HTTP 404 for `/api/jobs`.

- [ ] **Step 3: Wire the job routes**

Apply the existing download limiter to create/retry, validate UUID params, translate policy errors consistently, send `202/404/409/429/503` exactly as specified, and use `res.download` only after a completed job is consumed safely.

- [ ] **Step 4: Add health test and implement cached dependency checks**

The test server sets `HEALTHCHECK_BINARIES=false` so the response deterministically asserts `status`, `outputDirectory`, `active`, `queued`, `maxActive`, and `maxQueued`. Production defaults to checking Python, yt-dlp, FFmpeg, and configured Deno with `execFile --version` and a five-second cache.

- [ ] **Step 5: Add cancel, retry, validation, and information-leak assertions**

Assert that invalid format/bitrate return 400, a blocking fixture can be cancelled, a failed fixture can be retried, public JSON lacks `url`, `clientId`, `filePath`, and `stderr`, and unknown UUIDs return `JOB_NOT_FOUND`.

- [ ] **Step 6: Run server suite and confirm GREEN**

Run: `npm --prefix server test`
Expected: all server tests PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add server/index.js server/.env.example server/test/job-api.test.js server/test/http-security.test.js
git commit -m "feat: expose download job API"
```

### Task 5: Client job API helpers and quality UI

**Files:**
- Create: `client/src/lib/download-jobs.ts`
- Create: `client/test/download-jobs.test.ts`
- Modify: `client/src/lib/youtube.ts`
- Modify: `client/test/youtube.test.ts`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Produces: `DownloadOptions`, `DownloadJob`, `readDownloadPreference`, `writeDownloadPreference`, `jobFileUrl`, and `jobStageLabel`.
- Consumes: the HTTP job API from Task 4.

- [ ] **Step 1: Write failing helper tests**

```ts
test('builds only safe internal job file URLs', () => {
  assert.equal(jobFileUrl('550e8400-e29b-41d4-a716-446655440000'), '/api/jobs/550e8400-e29b-41d4-a716-446655440000/file');
  assert.equal(jobFileUrl('../engine-download'), null);
});

test('normalizes stored preferences', () => {
  assert.deepEqual(normalizeDownloadPreference({ format: 'mp3', bitrate: 256 }), { format: 'mp3', bitrate: 192 });
  assert.deepEqual(normalizeDownloadPreference({ format: 'original' }), { format: 'original', bitrate: null });
});
```

- [ ] **Step 2: Run client tests and confirm RED**

Run: `npm --prefix client test`
Expected: FAIL because `download-jobs.ts` does not exist.

- [ ] **Step 3: Implement helpers and migrate safe URL checks**

Use a strict UUID regex, fixed stage-label map, exact option unions, and localStorage key `music-idl-download-options-v1`. Remove client reliance on `/api/engine-download` URLs.

- [ ] **Step 4: Replace direct download flow in App**

On click, POST `{ url, format, bitrate }`; poll every 1000 ms; show stage/progress; DELETE on cancel; POST retry on failed/cancelled; navigate a hidden anchor to the safe file URL on completed; clear intervals and ignore stale responses via a monotonically increasing request token.

- [ ] **Step 5: Add the format and bitrate controls**

Add accessible buttons for MP3/Fast Mode and 128/192/320; disable bitrate controls in Fast Mode; display that Fast Mode preserves the original audio; show final file name and byte size; keep only one active UI job.

- [ ] **Step 6: Run client tests, lint, and build**

Run: `npm --prefix client test`
Run: `npm --prefix client run lint`
Run: `npm --prefix client run build`
Expected: all commands PASS without warnings.

- [ ] **Step 7: Commit Task 5**

```bash
git add client/src/App.tsx client/src/lib/download-jobs.ts client/src/lib/youtube.ts client/test/download-jobs.test.ts client/test/youtube.test.ts
git commit -m "feat: add download progress and quality controls"
```

### Task 6: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `server/README.md`

**Interfaces:**
- Consumes: all production behavior from Tasks 1-5.
- Produces: deployment configuration and manual smoke-test instructions.

- [ ] **Step 1: Document the job flow and options**

Document the six job/health routes, default MP3 192 kbps, Fast Mode limitations, job TTL, single-process limitation, required binaries, and fixture-based automated tests.

- [ ] **Step 2: Run the complete verification matrix**

Run: `npm --prefix server test`
Run: `npm --prefix server run test:engine`
Run: `node --check server/index.js`
Run: `python3 -m py_compile server/engine/music_dl.py`
Run: `npm --prefix client test`
Run: `npm --prefix client run lint`
Run: `npm --prefix client run build`
Run: `npm --prefix server audit`
Run: `npm --prefix client audit`
Run: `git diff --check`
Expected: every command exits 0; audits report no known vulnerabilities.

- [ ] **Step 3: Run a local fixture smoke test**

Start the server with `PYTHON_BIN=node ENGINE_SCRIPT_PATH=test/fixtures/fake-engine.js HEALTHCHECK_BINARIES=false`, create an MP3 job, observe progress, download its file, repeat with Fast Mode, cancel a blocking job, and retry a failed job. No external network is required.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md server/README.md docs/superpowers/specs/2026-09-16-download-jobs-design.md docs/superpowers/plans/2026-09-16-download-jobs-quality-plan.md
git commit -m "docs: document asynchronous audio downloads"
```

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractYouTubeVideoId, safeInternalDownloadUrl } from '../src/lib/youtube.ts';

test('extractYouTubeVideoId accepts exact HTTPS YouTube hosts only', () => {
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=tracking'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeVideoId('http://127.0.0.1/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeVideoId('https://music.apple.com/id/album/example/1'), null);
});

test('safeInternalDownloadUrl rejects external and unexpected API targets', () => {
  const valid = '/api/engine-download?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ';
  assert.equal(safeInternalDownloadUrl(valid), valid);
  assert.equal(safeInternalDownloadUrl('https://evil.example/audio.mp3'), null);
  assert.equal(safeInternalDownloadUrl('/api/proxy-download?url=https://evil.example'), null);
  assert.equal(safeInternalDownloadUrl('/api/engine-download?url=http://127.0.0.1/private'), null);
});

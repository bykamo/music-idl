import test from 'node:test';
import assert from 'node:assert/strict';

import {
  jobFileUrl,
  jobStageLabel,
  normalizeDownloadPreference,
  readDownloadPreference,
  writeDownloadPreference,
} from '../src/lib/download-jobs.ts';

test('normalizes output preferences to supported values', () => {
  assert.deepEqual(normalizeDownloadPreference(undefined), { format: 'mp3', bitrate: 192 });
  assert.deepEqual(normalizeDownloadPreference({ format: 'mp3', bitrate: 320 }), { format: 'mp3', bitrate: 320 });
  assert.deepEqual(normalizeDownloadPreference({ format: 'mp3', bitrate: 256 }), { format: 'mp3', bitrate: 192 });
  assert.deepEqual(normalizeDownloadPreference({ format: 'original', bitrate: 128 }), { format: 'original', bitrate: null });
});

test('reads and writes preferences through the supplied storage boundary', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  writeDownloadPreference({ format: 'mp3', bitrate: 128 }, storage);
  assert.deepEqual(readDownloadPreference(storage), { format: 'mp3', bitrate: 128 });
  values.set('music-idl-download-options-v1', 'invalid-json');
  assert.deepEqual(readDownloadPreference(storage), { format: 'mp3', bitrate: 192 });
});

test('builds file URLs only from exact UUID job identifiers', () => {
  assert.equal(
    jobFileUrl('550e8400-e29b-41d4-a716-446655440000'),
    '/api/jobs/550e8400-e29b-41d4-a716-446655440000/file',
  );
  assert.equal(jobFileUrl('../engine-download'), null);
  assert.equal(jobFileUrl('550e8400-e29b-41d4-a716-446655440000/other'), null);
});

test('returns fixed human-readable labels for engine stages', () => {
  assert.equal(jobStageLabel('downloading'), 'Mengunduh audio');
  assert.equal(jobStageLabel('unexpected'), 'Memproses audio');
});

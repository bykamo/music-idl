export type DownloadFormat = 'mp3' | 'original';
export type Mp3Bitrate = 128 | 192 | 320;

export interface DownloadPreference {
  format: DownloadFormat;
  bitrate: Mp3Bitrate | null;
}

export interface DownloadJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  message: string;
  fileName: string | null;
  fileSize: number | null;
  outputFormat: string;
  bitrate: Mp3Bitrate | null;
  error: { code: string; message: string } | null;
}

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}

const STORAGE_KEY = 'music-idl-download-options-v1';
const DEFAULT_PREFERENCE: DownloadPreference = { format: 'mp3', bitrate: 192 };
const BITRATES = new Set([128, 192, 320]);
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_LABELS: Record<string, string> = {
  queued: 'Menunggu antrean',
  metadata: 'Mengambil metadata',
  downloading: 'Mengunduh audio',
  encoding: 'Mengubah format audio',
  tagging: 'Menambahkan metadata',
  completed: 'File siap diunduh',
  failed: 'Unduhan gagal',
  cancelled: 'Unduhan dibatalkan',
};

export function normalizeDownloadPreference(value: unknown): DownloadPreference {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCE };
  const candidate = value as { format?: unknown; bitrate?: unknown };
  if (candidate.format === 'original') return { format: 'original', bitrate: null };
  if (candidate.format === 'mp3' && BITRATES.has(candidate.bitrate as number)) {
    return { format: 'mp3', bitrate: candidate.bitrate as Mp3Bitrate };
  }
  return { ...DEFAULT_PREFERENCE };
}

export function readDownloadPreference(
  storage: PreferenceStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): DownloadPreference {
  if (!storage) return { ...DEFAULT_PREFERENCE };
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return stored ? normalizeDownloadPreference(JSON.parse(stored)) : { ...DEFAULT_PREFERENCE };
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

export function writeDownloadPreference(
  preference: DownloadPreference,
  storage: PreferenceStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeDownloadPreference(preference)));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory choice still works.
  }
}

export function jobFileUrl(id: string): string | null {
  return JOB_ID_PATTERN.test(id) ? `/api/jobs/${id}/file` : null;
}

export function jobStageLabel(stage: string): string {
  return STAGE_LABELS[stage] || 'Memproses audio';
}

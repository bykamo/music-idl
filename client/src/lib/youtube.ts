const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const LOCAL_ORIGIN = 'https://music-idl.invalid';

export function extractYouTubeVideoId(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== '443')
  ) return null;

  let videoId: string | null | undefined;
  if (parsed.hostname === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0];
  } else if (YOUTUBE_HOSTS.has(parsed.hostname)) {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v');
    } else {
      const [kind, id] = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'live', 'shorts'].includes(kind)) videoId = id;
    }
  }
  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

export function safeInternalDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(value, LOCAL_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== LOCAL_ORIGIN || parsed.pathname !== '/api/engine-download') return null;
  if (!extractYouTubeVideoId(parsed.searchParams.get('url') || '')) return null;
  return `${parsed.pathname}${parsed.search}`;
}

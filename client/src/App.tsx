import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, User, Loader2, Eye, ThumbsUp, Info, Link as LinkIcon, ClipboardPaste, Music, Trash2, X } from 'lucide-react';
import { YouTubeMusicIcon } from '@/components/ui/youtube-music-icon';
import DotField from '@/components/ui/DotField';
import Loader from '@/components/ui/loader';
import { SearchSkeleton } from '@/components/ui/search-skeleton';
import { AnimatedThemeToggle } from '@/components/ui/theme-toggle';
import { LimitDialog } from '@/components/ui/limit-dialog';
import { extractYouTubeVideoId, safeInternalDownloadUrl } from '@/lib/youtube';

interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

interface SearchResult {
  videoId: string;
  name: string;
  artist: { name: string };
  album?: { name: string } | null;
  thumbnails: Thumbnail[];
  type: string;
  isDirect?: boolean;
  externalData?: {
    thumbnail?: string;
    channel?: string;
    title?: string;
    download_url?: string;
    bitrate?: string;
    filesize?: number;
    duration_sec?: number;
    view_count?: number;
    like_count?: number;
    upload_date?: string;
  };
}

interface ExternalInfo {
  status?: boolean;
  title: string;
  channel: string;
  album?: string; // Added album
  artist?: { name: string };
  duration_sec: number;
  bitrate: string;
  filesize: number;
  view_count: number;
  like_count: number;
  upload_date: string;
  thumbnail: string;
  download_url?: string;
}

interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  stage?: 'download' | 'converting' | null;
  progressPct?: number | null;
  error?: string | null;
}

interface PlaylistEntry {
  videoId: string;
  title: string;
  duration_sec: number;
  thumbnail: string;
}

interface PlaylistPayload {
  playlist_id: string;
  title: string;
  channel: string;
  count: number;
  entries: PlaylistEntry[];
}

const API_BASE = '/api';

function getApiStatus(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function getApiMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError<{ message?: string }>(error)) return fallback;
  return error.response?.data?.message || fallback;
}

function getDownloadUrlFromApiResponse(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  return safeInternalDownloadUrl((data as { download_url?: unknown }).download_url);
}

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadStage, setDownloadStage] = useState<{ stage: 'queue' | 'download' | 'convert', pct: number | null } | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistPayload | null>(null);
  const [detailedInfo, setDetailedInfo] = useState<Record<string, ExternalInfo>>({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLimitOpen, setIsLimitOpen] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ isOpen: boolean, title: string, message: string, isLimit: boolean }>({
    isOpen: false,
    title: '',
    message: '',
    isLimit: false
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    }
    return 'dark';
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      alert('Masukkan link musik terlebih dahulu.');
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setResults([]);
    setDownloadSuccess(false);
    setPlaylist(null);

    try {
      // Playlist Flow: link playlist YouTube (list=...) tanpa parameter v
      const isPlaylistUrl = (() => {
        try {
          const u = new URL(query.trim());
          const host = u.hostname.replace(/^www\./, '');
          if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return false;
          if (u.searchParams.get('v')) return false;
          const list = u.searchParams.get('list') || '';
          return /^[A-Za-z0-9_-]{12,64}$/.test(list) && !list.startsWith('RD') && !list.startsWith('UL');
        } catch { return false; }
      })();

      if (isPlaylistUrl) {
        try {
          const response = await axios.get(`${API_BASE}/playlist?url=${encodeURIComponent(query.trim())}`, { timeout: 70000 });
          const payload = response.data as PlaylistPayload;
          if (!payload.entries || payload.entries.length === 0) throw new Error('Playlist kosong.');
          setPlaylist(payload);
        } catch (err) {
          setErrorDialog({
            isOpen: true,
            title: 'Playlist Tidak Tersedia',
            message: getApiMessage(err, 'Playlist tidak dapat dibaca. Pastikan playlist YouTube publik dan masih tersedia.'),
            isLimit: getApiStatus(err) === 429
          });
        } finally { setLoading(false); }
        return;
      }

      // YouTube Flow
      const extractedId = extractYouTubeVideoId(query.trim());
      if (/^https?:\/\//i.test(query.trim()) && !extractedId) {
        setErrorDialog({
          isOpen: true,
          title: 'Link Tidak Didukung',
          message: 'Saat ini hanya link video YouTube HTTPS yang didukung.',
          isLimit: false
        });
        return;
      }
      if (extractedId) {
        const normalizedUrl = `https://www.youtube.com/watch?v=${extractedId}`;
        setResults([{
          videoId: extractedId,
          name: 'YouTube Video (Processing...)',
          artist: { name: 'Auto loading' },
          thumbnails: [{ url: `https://i.ytimg.com/vi/${extractedId}/hqdefault.jpg`, width: 480, height: 360 }],
          type: 'VIDEO',
          isDirect: true
        }] as SearchResult[]);

        try {
          const response = await axios.get(`${API_BASE}/url-info?url=${encodeURIComponent(normalizedUrl)}`);
          if (response.data) {
            setResults([response.data]);
            if (response.data.externalData) {
              setDetailedInfo(prev => ({ ...prev, [extractedId]: response.data.externalData }));
            }
          } else { throw new Error('No Data'); }
        } catch {
          try {
            const fallback = await axios.get(`${API_BASE}/fallback-download?videoId=${extractedId}`);
            if (fallback.data && fallback.data.status) {
              const data = fallback.data;
              const resObj = {
                videoId: extractedId,
                name: data.title || 'YouTube Video',
                artist: { name: data.channel || 'Unknown Artist' },
                thumbnails: [{ url: data.thumbnail || `https://i.ytimg.com/vi/${extractedId}/hqdefault.jpg`, width: 1280, height: 720 }],
                type: 'VIDEO',
                isDirect: true
              };
              setResults([resObj]);
              setDetailedInfo(prev => ({ ...prev, [extractedId]: data }));
            } else { throw new Error('No fallback data'); }
          } catch {
            setErrorDialog({
              isOpen: true,
              title: 'Gagal',
              message: 'Gagal mendapatkan informasi video.',
              isLimit: false
            });
            setResults([]);
          }
        }
      } else {
        // Normal Search
        const response = await axios.get(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
        setResults(response.data);
      }
    } catch (err) {
      setErrorDialog({
        isOpen: true,
        title: 'Pencarian Gagal',
        message: getApiMessage(err, 'Pencarian tidak dapat diproses. Silakan coba lagi.'),
        isLimit: getApiStatus(err) === 429
      });
    } finally { setLoading(false); }
  };

  const handlePaste = async () => {
    try {
      // iOS Safari and some mobile browsers have strict security around clipboard API.
      // We check if readText is supported, otherwise fallback to standard prompt or show helper.
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        // Fallback using prompt for older browsers or strict iOS environment
        const text = prompt("Tempel link di sini:");
        if (text) {
          setQuery(text);
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }
        return;
      }

      const text = await navigator.clipboard.readText();
      if (text) {
        setQuery(text);
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      // Fallback on permission denial or other issues
      const text = prompt("Tempel link di sini:");
      if (text) {
        setQuery(text);
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    }
  };

  const sanitizeDownloadTitle = (rawTitle: string): string => {
    if (!rawTitle) return 'Audio Track';
    const clean = rawTitle
      .replace(/\s*\[[a-zA-Z0-9_-]{11}\]/g, '')
      .replace(/\b(?:official\s+(?:music\s+)?video|official\s+audio|audio\s+official|lyric\s+video|lyrics?|visuali[sz]er|music\s+video|mv|hd|4k)\b/gi, '')
      .replace(/[/\\?%*:|"<>]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-_.\s]+|[-_.\s]+$/g, '');
    return clean || 'Audio Track';
  };

  const triggerDownload = (url: string, title: string, videoId: string) => {
    const downloadUrl = safeInternalDownloadUrl(url);
    if (!downloadUrl) {
      setErrorDialog({
        isOpen: true,
        title: 'Link Unduhan Tidak Valid',
        message: 'Server mengirim link unduhan yang tidak dapat dipercaya.',
        isLimit: false
      });
      return;
    }

    setDownloading(videoId);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${sanitizeDownloadTitle(title)}.mp3`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloading(null);
    setDownloadSuccess(true);
  };

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  // Job asinkron: buat job, polling status per ~1.2s sampai selesai/gagal
  const startJobDownload = async (videoId: string, title: string): Promise<string> => {
    const created = await axios.post<{ jobId: string }>(`${API_BASE}/jobs`, {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: title || videoId
    }, { timeout: 20000 });
    const jobId = created.data && created.data.jobId;
    if (!jobId) throw new Error('Job unduhan gagal dibuat.');
    setDownloadStage({ stage: 'queue', pct: null });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 9 * 60 * 1000) {
      await sleep(1200);
      const { data } = await axios.get<JobStatus>(`${API_BASE}/jobs/${jobId}`, { timeout: 10000 });
      if (data.status === 'done') {
        setDownloadStage(null);
        return jobId;
      }
      if (data.status === 'error') {
        setDownloadStage(null);
        throw new Error(data.error || 'Engine gagal memproses unduhan.');
      }
      setDownloadStage({
        stage: data.stage === 'converting' ? 'convert' : 'download',
        pct: data.progressPct ?? null
      });
    }
    setDownloadStage(null);
    throw new Error('Batas waktu unduhan terlampaui.');
  };

  const downloadMusic = async (videoId: string, title: string) => {
    setDownloading(videoId);
    try {
      // Jalur baru (P3-A): job asinkron dengan progress, lalu ambil file dari server
      try {
        const jobId = await startJobDownload(videoId, title);
        const link = document.createElement('a');
        link.href = `${API_BASE}/jobs/${jobId}/file`;
        link.setAttribute('download', `${sanitizeDownloadTitle(title)}.mp3`);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloadSuccess(true);
        return;
      } catch (jobErr: unknown) {
        if (getApiStatus(jobErr) === 429) {
          setIsLimitOpen(true);
          return;
        }
        // Job gagal dibuat/dalam proses (503 sibuk, engine error) → coba jalur klasik
      }

      const ext = detailedInfo[videoId];
      if (ext?.download_url) {
        triggerDownload(ext.download_url, ext.title || title, videoId);
        return;
      }

      const response = await axios.get(`${API_BASE}/download?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
      const downloadUrl = getDownloadUrlFromApiResponse(response.data);
      if (downloadUrl) {
        triggerDownload(downloadUrl, response.data.title || title, videoId);
      }
    } catch (err: unknown) {
      if (getApiStatus(err) === 429) {
        setIsLimitOpen(true);
        return;
      }
      if (getApiStatus(err) === 403) {
        setErrorDialog({
          isOpen: true,
          title: 'Server Limit',
          message: getApiMessage(err, 'Server menolak permintaan unduhan.'),
          isLimit: false
        });
        return;
      }

      try {
        const fb = await axios.get(`${API_BASE}/fallback-download?videoId=${videoId}`);
        const fallbackUrl = getDownloadUrlFromApiResponse(fb.data);
        if (fallbackUrl) {
          triggerDownload(fallbackUrl, title, videoId);
        } else {
          throw new Error('Server tidak mengirim link unduhan yang valid.', { cause: err });
        }
      } catch (fallbackError: unknown) {
        setErrorDialog({
          isOpen: true,
          title: 'Gagal',
          message: getApiMessage(fallbackError, 'Gagal mengunduh lagu. Silakan coba beberapa saat lagi.'),
          isLimit: false
        });
      }
    } finally {
      setDownloading(null);
      setDownloadStage(null);
    }
  };

  const downloadAllSequential = async () => {
    if (!playlist || playlist.entries.length === 0) return;
    for (const entry of playlist.entries) {
      try {
        await downloadMusic(entry.videoId, entry.title);
      } catch {
        // Lanjut ke item berikutnya meski satu gagal
      }
    }
  };

  const fetchExternalInfo = async (videoId: string) => {
    if (detailedInfo[videoId]) return;
    try {
      const response = await axios.get(`${API_BASE}/external-info?videoId=${videoId}`);
      const data = response.data || {};
      if (data.status || data.download_url) {
        setDetailedInfo(prev => ({ ...prev, [videoId]: data }));
      }
    } catch (err) {
      console.error('Failed to fetch detailed info', err);
    }
  };

  const getBestThumbnail = (item: SearchResult) => {
    const ext = detailedInfo[item.videoId];
    if (ext && ext.thumbnail) {
      if (ext.thumbnail.includes('hqdefault.jpg')) return ext.thumbnail.replace('hqdefault.jpg', 'maxresdefault.jpg');
      return ext.thumbnail;
    }
    if (item.externalData?.thumbnail) {
      const thumb = item.externalData.thumbnail;
      if (typeof thumb === 'string' && thumb.includes('hqdefault.jpg')) return thumb.replace('hqdefault.jpg', 'maxresdefault.jpg');
      return thumb;
    }
    if (item.thumbnails && item.thumbnails.length > 0) {
      return item.thumbnails.reduce((prev, current) => (prev.width > current.width) ? prev : current).url;
    }
    return `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg`;
  };

  const formatViews = (views: number) => {
    if (!views) return '0';
    if (views >= 1000000) return (views / 1000000).toFixed(1) + 'M';
    if (views >= 1000) return (views / 1000).toFixed(1) + 'K';
    return views.toString();
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 MB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCloseLimitDialog = () => {
    setIsLimitOpen(false);
    setQuery(''); // Kosongkan input
    setResults([]); // Kosongkan hasil pencarian
    setLoading(false); // Pastikan loading berhenti
  };

  return (
    <>
      <LimitDialog isOpen={isLimitOpen} onClose={handleCloseLimitDialog} />
      <LimitDialog
        isOpen={errorDialog.isOpen}
        onClose={() => setErrorDialog(prev => ({ ...prev, isOpen: false }))}
        title={errorDialog.title}
        description={errorDialog.message}
        isLimit={errorDialog.isLimit}
      />
      {isInitialLoading && <Loader />}
      <div className="relative min-h-screen w-full bg-background transition-colors duration-300 overflow-x-hidden">
        <DotField
          className="absolute inset-0 z-0 pointer-events-none"
          dotRadius={5}
          dotSpacing={14}
          bulgeStrength={67}
          glowRadius={160}
          sparkle={false}
          waveAmplitude={0}
          cursorRadius={100}
          cursorForce={0.8}
          bulgeOnly={false}
          gradientFrom={theme === 'dark' ? 'rgba(185, 28, 28, 0.35)' : 'rgba(185, 28, 28, 0.15)'}
          gradientTo={theme === 'dark' ? 'rgba(185, 28, 28, 0.15)' : 'rgba(185, 28, 28, 0.05)'}
          glowColor="transparent"
        />
        <div className="max-w-5xl mx-auto px-4 py-8 relative z-10">
          <div className="fixed top-6 right-6 z-50">
            <AnimatedThemeToggle theme={theme} setTheme={setTheme} />
          </div>

          <div className="text-center mb-10 space-y-4 pt-6 md:pt-2">
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-primary">
              Music IDL
            </h1>
            <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
              Pilih platform dan tempel link untuk mulai mengunduh.
            </p>
          </div>

          <form onSubmit={handleAction} className="relative max-w-2xl mx-auto mb-10 md:mb-12">
            <div className="relative group">
              <input
                ref={inputRef}
                type="text"
                id="music-url-input"
                name="music-url"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tempel link YouTube atau ketik judul lagu..."
                className="w-full bg-card border border-border rounded-full py-4 px-5 pl-14 pr-14 text-foreground placeholder:text-muted-foreground caret-primary selection:bg-primary/30 focus:outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/10 transition-all text-base shadow-xl"
              />
              <YouTubeMusicIcon className="absolute left-5 top-1/2 -translate-y-1/2 text-primary" size={20} />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                {!query.trim() ? (
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="bg-card hover:bg-muted active:scale-90 text-foreground p-2 rounded-full transition-all flex items-center justify-center min-w-[36px] min-h-[36px] shadow-sm border border-border"
                    title="Tempel dari clipboard"
                  >
                    <ClipboardPaste size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setResults([]);
                      setDownloadSuccess(false);
                      inputRef.current?.focus();
                    }}
                    className="bg-card hover:bg-muted active:scale-90 text-foreground hover:text-red-500 p-2 rounded-full transition-all flex items-center justify-center min-w-[36px] min-h-[36px] shadow-sm border border-border"
                    title="Hapus tautan"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className={`w-fit relative px-8 py-3 rounded-full font-bold transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 overflow-hidden ${loading ? 'bg-muted border border-border text-foreground' : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]'}`}
              >
                <span className="relative z-10 flex items-center gap-2">
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <Download size={20} />
                      Unduh Musik
                    </>
                  )}
                </span>
              </button>

              {downloadSuccess && !loading && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    setDownloadSuccess(false);
                    inputRef.current?.focus();
                  }}
                  className="w-fit px-8 py-3 bg-card hover:bg-muted text-foreground rounded-full font-semibold transition-all border border-border flex items-center justify-center gap-2 text-sm"
                >
                  <Music size={16} /> Unduh Musik Lainnya
                </button>
              )}
            </div>
          </form>

          {playlist && (
            <div className="glass-card max-w-2xl mx-auto mb-10 p-4 md:p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <span className="bg-primary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase text-primary-foreground">
                    {playlist.count} lagu
                  </span>
                  <h3 className="mt-2 font-bold text-lg text-foreground truncate">{playlist.title}</h3>
                  {playlist.channel && <p className="text-xs text-muted-foreground truncate">{playlist.channel}</p>}
                </div>
                <button onClick={() => setPlaylist(null)} className="text-muted-foreground hover:text-foreground shrink-0 transition-colors" title="Tutup playlist">
                  <X size={18} />
                </button>
              </div>
              <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto pr-1">
                {playlist.entries.map((entry) => (
                  <div key={entry.videoId} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-2">
                    <img
                      src={entry.thumbnail}
                      alt={entry.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-11 w-11 rounded-lg object-cover bg-muted shrink-0"
                      onError={(e) => {
                        const t = e.target as HTMLImageElement;
                        if (!t.src.includes('hqdefault.jpg')) t.src = `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`;
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{entry.title}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDuration(entry.duration_sec)}</p>
                    </div>
                    <button
                      onClick={() => downloadMusic(entry.videoId, entry.title)}
                      disabled={!!downloading}
                      className="shrink-0 bg-primary text-primary-foreground rounded-full px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-60 hover:opacity-90 active:scale-95"
                    >
                      {downloading === entry.videoId ? (
                        <Loader2 className="animate-spin" size={12} />
                      ) : (
                        <Download size={12} />
                      )}
                      {downloading === entry.videoId ? '...' : 'Unduh'}
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={downloadAllSequential}
                disabled={!!downloading}
                className={`mt-4 w-full py-2.5 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-70 ${downloading ? 'bg-muted border border-border text-foreground' : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99]'}`}
              >
                {downloading ? (
                  <>
                    <Loader2 className="animate-spin" size={14} />
                    Mengunduh berurutan (max 100)...
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    Unduh Semuanya ({playlist.entries.length})
                  </>
                )}
              </button>
            </div>
          )}

          {loading && <SearchSkeleton />}

          {!loading && results.length > 0 && (
            <div className="flex flex-col items-center gap-6 max-w-sm md:max-w-lg mx-auto w-full">
              {results.map((item) => {
                const ext = detailedInfo[item.videoId];
                const platform = 'YouTube Music';
                return (
                  <div key={item.videoId} className="glass-card flex flex-col group relative hover:-translate-y-1 w-full">
                    <div className="relative aspect-square overflow-hidden bg-muted">
                      <img
                        src={getBestThumbnail(item)}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          const t = e.target as HTMLImageElement;
                          if (t.src.includes('maxresdefault')) t.src = `https://i.ytimg.com/vi/${item.videoId}/sddefault.jpg`;
                          else if (t.src.includes('sddefault')) t.src = `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-80"></div>
                      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                        <div className="flex flex-col gap-1 w-full">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="bg-primary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase w-fit text-primary-foreground">
                              {ext ? ext.bitrate : 'hingga 320kbps'}
                            </span>
                            <span className="bg-black/70 border border-white/10 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white">
                              {platform}
                            </span>
                          </div>
                          <h3 className="text-lg font-bold line-clamp-2 leading-tight text-white drop-shadow-lg">
                            {ext?.title || item.name}
                          </h3>
                        </div>
                      </div>
                      {ext && (
                        <span className="absolute top-4 right-4 bg-black/80 backdrop-blur px-2 py-1 rounded text-xs font-mono text-white">
                          {formatDuration(ext.duration_sec)}
                        </span>
                      )}
                    </div>

                    <div className="p-4 flex-grow flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-1">
                          <p className="text-foreground flex items-center gap-1.5 truncate font-medium">
                            <User size={12} className="text-primary" />
                            {ext ? ext.channel : item.artist.name}
                          </p>
                        </div>
                        {ext && (ext.view_count > 0 || ext.like_count > 0) ? (
                          <div className="space-y-1 text-right">
                            {ext.view_count > 0 && <p className="text-muted-foreground flex items-center justify-end gap-1">{formatViews(ext.view_count)} <Eye size={12} /></p>}
                            {ext.like_count > 0 && <p className="text-muted-foreground flex items-center justify-end gap-1">{formatViews(ext.like_count)} <ThumbsUp size={12} /></p>}
                          </div>
                        ) : (
                          <button onClick={() => fetchExternalInfo(item.videoId)} className="text-[10px] text-primary/70 hover:text-primary flex items-center justify-end gap-1 transition-colors"><Info size={10} /> Detail</button>
                        )}
                      </div>
                      {ext && ext.filesize > 0 && (
                        <div className="bg-muted/50 rounded-lg p-2.5 border border-border space-y-1">
                          <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold tracking-wider"><span>Size</span><span>Bitrate</span></div>
                          <div className="flex justify-between text-[11px] font-medium"><span className="text-foreground">{formatSize(ext.filesize)}</span><span className="text-foreground">{ext.bitrate}</span></div>
                        </div>
                      )}
                      <div className="mt-auto pt-2 flex flex-col items-center gap-2">
                        <button
                          onClick={() => downloadMusic(item.videoId, ext?.title || item.name)}
                          disabled={!!downloading}
                          className={`w-full relative px-8 py-2.5 rounded-full font-bold transition-all flex items-center justify-center gap-2 shadow-md text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 overflow-hidden ${downloading === item.videoId ? 'bg-muted border border-border text-foreground' : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]'}`}
                        >
                          <span className="relative z-10 flex items-center gap-2">
                            {downloading === item.videoId ? (
                              downloadStage?.stage === 'convert' ? (
                                <>
                                  <Loader2 className="animate-spin" size={16} />
                                  Konversi MP3...
                                </>
                              ) : downloadStage?.stage === 'download' && downloadStage.pct !== null ? (
                                <>
                                  <Loader2 className="animate-spin" size={16} />
                                  Mengunduh {downloadStage.pct}%
                                </>
                              ) : (
                                <>
                                  <Loader2 className="animate-spin" size={16} />
                                  Menyiapkan unduhan...
                                </>
                              )
                            ) : (
                              <>
                                <Download size={16} />
                                Unduh MP3
                              </>
                            )}
                          </span>
                        </button>
                        {downloading === item.videoId && downloadStage?.stage === 'download' && downloadStage.pct !== null && (
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${downloadStage.pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="text-center py-16 md:py-24">
              <div className="inline-block p-6 rounded-full bg-card border border-border mb-6 shadow-sm"><LinkIcon size={48} className="text-primary" /></div>
              <h2 className="text-2xl font-bold text-foreground">Siap untuk download?</h2>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto text-left">
                {[
                  ['1', 'Cari musik', 'Ketik judul lagu atau link YouTube.'],
                  ['2', 'Tempel link', 'Masukkan URL musik yang ingin diunduh.'],
                  ['3', 'Unduh musik', 'Cek hasil dan unduh MP3.'],
                ].map(([step, title, desc]) => (
                  <div key={step} className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{step}</div>
                    <p className="font-bold text-foreground">{title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <footer className="mt-14 pb-2 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
              Download MP3 cepat, simpel, dan responsif
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

export default App;

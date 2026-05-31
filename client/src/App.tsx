import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import { Search, Download, User, Loader2, Eye, ThumbsUp, Info, Link as LinkIcon, ClipboardPaste, Music } from 'lucide-react';
import { AppleMusicIcon } from '@/components/ui/apple-music-icon';
import { YouTubeMusicIcon } from '@/components/ui/youtube-music-icon';
import { NeuralNoise } from '@/components/ui/neural-noise';
import Loader from '@/components/ui/loader';
import { AnimatedThemeToggle } from '@/components/ui/theme-toggle';
import { LimitDialog } from '@/components/ui/limit-dialog';

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
  } | any;
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

const API_BASE = '/api';

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'youtube' | 'apple'>('youtube');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [detailedInfo, setDetailedInfo] = useState<Record<string, ExternalInfo>>({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLimitOpen, setIsLimitOpen] = useState(false);
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
    if (query.includes('music.apple.com')) setActiveTab('apple');
    else if (query.includes('youtu')) setActiveTab('youtube');
  }, [query]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const extractVideoId = (url: string) => {
    const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[1].length === 11) ? match[1] : null;
  };

  const getDownloadUrlFromApiResponse = (data: any) => {
    if (!data || typeof data !== 'object') return null;
    return data.download_url || data.url || data.result?.download_url || data.result?.url || data.data?.download_url || data.data?.url;
  };

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResults([]);
    setDownloadSuccess(false);
    try {
      if (activeTab === 'apple' || query.includes('music.apple.com')) {
        // Apple Music Flow
        const placeholderId = `am-${Date.now()}`;
        setResults([{
          videoId: placeholderId,
          name: 'Apple Music Song (Processing...)',
          artist: { name: 'Auto loading' },
          thumbnails: [{ url: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/3d/0d/1d/3d0d1d23-2345-2345-2345-234523452345/source/512x512bb.jpg', width: 480, height: 360 }],
          type: 'SONG',
          isDirect: true
        }] as SearchResult[]);

        try {
          const response = await axios.get(`${API_BASE}/url-info?url=${encodeURIComponent(query)}`);
          const data = response.data;
          const videoId = data.videoId || placeholderId;
          setResults([data]);
          if (data.externalData?.download_url) {
            setDetailedInfo(prev => ({ ...prev, [videoId]: data.externalData }));
          }
        } catch (err) {
          console.error('Apple Music failed', err);
          alert('Gagal mengambil informasi dari link Apple Music.');
          setResults([]);
        }
      } else {
        // YouTube Flow
        const extractedId = extractVideoId(query);
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
          } catch (err) {
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
            } catch (e) { 
              Swal.fire({
                icon: 'error',
                title: 'Gagal',
                text: 'Gagal mendapatkan informasi video.',
                background: '#1f2937',
                color: '#fff',
                confirmButtonColor: '#3b82f6'
              });
              setResults([]); 
            }
          }
        } else {
          // Normal Search
          const response = await axios.get(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
          setResults(response.data);
        }
      }
    } catch (err) { 
      console.error('Action failed', err); 
    } finally { 
      setLoading(false); 
    }
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

  const triggerDownload = async (url: string, title: string, videoId: string, metadata?: { artist?: string; image?: string; album?: string }) => {
    setDownloading(videoId);
    const params = new URLSearchParams({
      url,
      filename: `${title}.mp3`,
      title
    });

    if (metadata?.artist) params.append('artist', metadata.artist);
    if (metadata?.image) params.append('image', metadata.image);
    if (metadata?.album) params.append('album', metadata.album);

    const proxyUrl = `${API_BASE}/proxy-download?${params.toString()}`;

    // For mobile better handling: use a real click but check if it's actually downloading
    const link = document.createElement('a');
    link.href = proxyUrl;
    link.setAttribute('download', `${title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
        if (document.body.contains(link)) document.body.removeChild(link);
        setDownloading(null);
        setDownloadSuccess(true);
    }, 2000);
  };

  const downloadMusic = async (videoId: string, title: string) => {
    setDownloading(videoId);
    try {
      const ext = detailedInfo[videoId];
      if (ext?.download_url) {
        await triggerDownload(ext.download_url, ext.title || title, videoId, {
          artist: ext.channel || 'Unknown Artist',
          image: ext.thumbnail,
          album: ext.album
        });
        return;
      }

      if (videoId.startsWith('am-')) {
        Swal.fire({
          icon: 'warning',
          title: 'Link Kadaluarsa',
          text: 'Gunakan link Apple Music yang baru.',
          background: '#1f2937',
          color: '#fff',
          confirmButtonColor: '#3b82f6'
        });
        return;
      }

      const response = await axios.get(`${API_BASE}/download?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
      const downloadUrl = getDownloadUrlFromApiResponse(response.data);
      if (downloadUrl) {
        await triggerDownload(downloadUrl, response.data.title || title, videoId, {
          artist: response.data.channel || 'Unknown Artist',
          image: response.data.thumbnail,
          album: response.data.album || 'YouTube Download'
        });
      }
    } catch (err: any) {
      if (err.response?.status === 429) {
        setIsLimitOpen(true);
        return;
      }
      if (err.response?.status === 403 && err.response?.data?.message) {
        Swal.fire({
          icon: 'error',
          title: 'Server Limit',
          text: err.response.data.message,
          background: '#1f2937',
          color: '#fff',
          confirmButtonColor: '#3b82f6'
        });
        return;
      }

      if (!videoId.startsWith('am-')) {
        try {
          const fb = await axios.get(`${API_BASE}/fallback-download?videoId=${videoId}`);
          const fUrl = getDownloadUrlFromApiResponse(fb.data);
          if (fUrl) {
            await triggerDownload(fUrl, title, videoId, { 
              artist: fb.data.channel, 
              image: fb.data.thumbnail,
              album: 'YouTube Download'
            });
          } else if (fb.data?.message && fb.data.message.toLowerCase().includes('limit')) {
            setIsLimitOpen(true);
          }
        } catch (e: any) { 
          if (e.response?.data?.message) {
            Swal.fire({
              icon: 'error',
              title: 'Gagal',
              text: e.response.data.message,
              background: '#1f2937',
              color: '#fff',
              confirmButtonColor: '#3b82f6'
            });
          } else {
            Swal.fire({
              icon: 'error',
              title: 'Gagal',
              text: 'Gagal mendownload lagu. Kemungkinan semua limit server telah habis.',
              background: '#1f2937',
              color: '#fff',
              confirmButtonColor: '#3b82f6'
            });
          }
        }
      }
    } finally { setDownloading(null); }
  };

  const fetchExternalInfo = async (videoId: string) => {
    if (detailedInfo[videoId] || videoId.startsWith('am-')) return;
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
      {isInitialLoading && <Loader />}
      <div className="relative min-h-screen w-full bg-background transition-colors duration-300 overflow-x-hidden">
        <NeuralNoise color={[1.0, 0.0, 0.0]} opacity={0.5} />
        <div className="max-w-5xl mx-auto px-4 py-8 relative z-10">
          <div className="fixed top-6 right-6 z-50">
            <AnimatedThemeToggle theme={theme} setTheme={setTheme} />
          </div>

          <div className="text-center mb-10 space-y-3">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent">
            Music IDL
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
            Pilih platform, tempel link, dan unduh musik favoritmu.
          </p>
        </div>

        <div className="flex justify-center gap-3 mb-6">
          <button onClick={() => setActiveTab('youtube')} className={`px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 ${activeTab === 'youtube' ? 'bg-[#FF0000] text-white shadow-lg scale-105' : 'bg-card text-muted-foreground hover:bg-muted border border-border'}`}>
            <YouTubeMusicIcon size={18} /> YouTube
          </button>
          <button onClick={() => setActiveTab('apple')} className={`px-8 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 ${activeTab === 'apple' ? 'bg-[#fa243c] text-white shadow-lg scale-105' : 'bg-card text-muted-foreground hover:bg-muted border border-border'}`}>
            <AppleMusicIcon size={18} /> Apple Music
          </button>
        </div>

        <form onSubmit={handleAction} className="relative max-w-xl mx-auto mb-12">
          <div className="relative group">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={activeTab === 'apple' ? "Tempel link Apple Music..." : "Tempel link YouTube atau ketik judul lagu..."}
              className="w-full bg-card border border-border rounded-xl py-4 px-5 pl-12 pr-14 text-foreground focus:outline-none focus:border-primary/50 transition-all text-base shadow-lg"
            />
            {activeTab === 'apple' ? (
              <AppleMusicIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#fa243c]" size={20} />
            ) : (
              <YouTubeMusicIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#FF0000]" size={20} />
            )}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
              {!query.trim() && (
                <button 
                  type="button" 
                  onClick={handlePaste} 
                  className="bg-muted/50 hover:bg-input active:scale-90 text-foreground p-2 rounded-lg transition-all flex items-center justify-center min-w-[36px] min-h-[36px] shadow-sm border border-border/50"
                  title="Tempel dari clipboard"
                >
                  <ClipboardPaste size={18} />
                </button>
              )}
            </div>
          </div>
          
          <div className="mt-3 flex flex-col gap-2">
            <button 
              type="submit" 
              disabled={loading} 
              className="w-full bg-primary hover:opacity-90 active:scale-[0.99] text-primary-foreground py-3.5 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg text-base"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : (query.includes('http') ? <><Download size={20} /> Unduh Sekarang</> : <><Search size={20} /> Cari Lagu</>)}
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
                className="w-full bg-card hover:bg-muted text-foreground py-2.5 rounded-xl font-semibold transition-all border border-border flex items-center justify-center gap-2 text-sm"
              >
                <Music size={16} /> Unduh Musik Lainnya
              </button>
            )}
          </div>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {results.map((item) => {
            const ext = detailedInfo[item.videoId];
            return (
              <div key={item.videoId} className="glass-card flex flex-col group relative">
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
                      <span className="bg-primary px-2 py-0.5 rounded text-[10px] font-bold uppercase w-fit text-primary-foreground">
                        {ext ? ext.bitrate : '320kbps'}
                      </span>
                      <h3 className="text-lg font-bold line-clamp-1 leading-tight text-white drop-shadow-lg">
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
                    {ext ? (
                      <div className="space-y-1 text-right">
                        <p className="text-muted-foreground flex items-center justify-end gap-1">{formatViews(ext.view_count)} <Eye size={12} /></p>
                        <p className="text-muted-foreground flex items-center justify-end gap-1">{formatViews(ext.like_count)} <ThumbsUp size={12} /></p>
                      </div>
                    ) : (
                      !item.videoId.startsWith('am-') && <button onClick={() => fetchExternalInfo(item.videoId)} className="text-[10px] text-primary/70 hover:text-primary flex items-center justify-end gap-1 transition-colors"><Info size={10} /> Detail</button>
                    )}
                  </div>
                  {ext && (
                    <div className="bg-muted/50 rounded-lg p-2.5 border border-border space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold tracking-wider"><span>Size</span><span>Bitrate</span></div>
                      <div className="flex justify-between text-[11px] font-medium"><span className="text-foreground">{formatSize(ext.filesize)}</span><span className="text-foreground">{ext.bitrate}</span></div>
                    </div>
                  )}
                  <div className="mt-auto pt-1">
                    <button onClick={() => downloadMusic(item.videoId, ext?.title || item.name)} disabled={!!downloading} className="w-full bg-primary text-primary-foreground hover:opacity-90 px-3 py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-2 shadow-md text-sm">
                      {downloading === item.videoId ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                      {downloading === item.videoId ? '...' : 'Unduh'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!loading && results.length === 0 && (
          <div className="text-center py-24">
            <div className="inline-block p-6 rounded-full bg-card border border-border mb-6 shadow-sm"><LinkIcon size={48} className="text-primary" /></div>
            <h2 className="text-2xl font-bold text-foreground">Siap untuk download?</h2>
            <p className="text-muted-foreground mt-2">Pilih platform di atas dan tempelkan link Anda.</p>
          </div>
        )}
      </div>
    </div>
  </>
);
}

export default App;

# music_dl.py
import yt_dlp
import sys
import os
import subprocess
import requests
from PIL import Image

def crop_to_square(image_path):
    try:
        if not os.path.exists(image_path):
            return False
        
        img = Image.open(image_path)
        width, height = img.size
        
        min_dim = min(width, height)
        left = (width - min_dim) / 2
        top = (height - min_dim) / 2
        right = (width + min_dim) / 2
        bottom = (height + min_dim) / 2
        
        img_cropped = img.crop((left, top, right, bottom))
        if img_cropped.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', img_cropped.size, (255, 255, 255))
            background.paste(img_cropped, mask=img_cropped.split()[3])
            img_cropped = background
            
        img_cropped.save(image_path, "JPEG", quality=90)
        return True
    except Exception as e:
        print(f"❌ Gagal crop thumbnail: {e}")
        return False

def embed_artwork_manual(mp3_path, image_path):
    if not os.path.exists(mp3_path) or not os.path.exists(image_path):
        return False
        
    temp_mp3 = mp3_path + ".temp.mp3"
    cmd = [
        'ffmpeg', '-y',
        '-i', mp3_path,
        '-i', image_path,
        '-map', '0:0',
        '-map', '1:0',
        '-c', 'copy',
        '-id3v2_version', '3',
        '-metadata:s:v', 'title="Album cover"',
        '-metadata:s:v', 'comment="Cover (Front)"',
        temp_mp3
    ]
    
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        os.replace(temp_mp3, mp3_path)
        return True
    except Exception as e:
        if os.path.exists(temp_mp3):
            os.remove(temp_mp3)
        return False

def get_oembed_info(url):
    try:
        r = requests.get(f"https://www.youtube.com/oembed?url={url}&format=json", timeout=10)
        if r.status_code == 200:
            data = r.json()
            return {
                'title': data.get('title', ''),
                'author': data.get('author_name', ''),
                'thumbnail': data.get('thumbnail_url', '')
            }
    except Exception:
        pass
    return None

def download_music(url):
    output_dir = "/home/ubuntu/music-idl/server/output_music"
    os.makedirs(output_dir, exist_ok=True)

    ydl_opts_base = {
        'format': 'ba/b/18',
        'proxy': 'socks5://127.0.0.1:40000',
        'remote_components': ['ejs:github'],
        'js_runtimes': {'deno': {'path': '/usr/local/bin/deno'}},
        'extractor_args': {
            'youtube': {
                'player_client': ['android']
            }
        },
        'postprocessors': [
            {
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '320',
            },
            {
                'key': 'FFmpegMetadata',
            }
        ],
        'writethumbnail': True,
        'quiet': False,
        'noprogress': False,
    }

    # Attempt 1: Direct Download
    ydl_opts = ydl_opts_base.copy()
    ydl_opts['outtmpl'] = os.path.join(output_dir, '%(title)s.%(ext)s')

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print(f"Mencoba direct download: {url}")
            info_dict = ydl.extract_info(url, download=True)
            if info_dict:
                original_filename = ydl.prepare_filename(info_dict)
                mp3_filename = os.path.splitext(original_filename)[0] + '.mp3'
                
                base_path = os.path.splitext(original_filename)[0]
                thumbnail_path = None
                for ext in ['.webp', '.jpg', '.png', '.jpeg']:
                    test_thumb = base_path + ext
                    if os.path.exists(test_thumb):
                        thumbnail_path = test_thumb
                        break
                
                if thumbnail_path and os.path.exists(mp3_filename):
                    if crop_to_square(thumbnail_path):
                        embed_artwork_manual(mp3_filename, thumbnail_path)
                    try:
                        os.remove(thumbnail_path)
                    except Exception:
                        pass
                if os.path.exists(mp3_filename):
                    print(f"✅ Direct Download Sukses: {mp3_filename}")
                    return
    except Exception as e:
        print(f"⚠️ Direct download gagal ({e}), mengaktifkan fallback hybrid...")

    # Attempt 2: Hybrid Bypass Fallback (oEmbed + ytsearch)
    oembed = get_oembed_info(url)
    search_query = url
    fallback_title = "Audio Track"
    custom_thumb_url = None

    if oembed and oembed.get('title'):
        fallback_title = oembed['title']
        custom_thumb_url = oembed.get('thumbnail')
        search_query = f"{oembed['title']} {oembed.get('author', '')} audio"
    
    print(f"🔄 Menjalankan pencarian fallback: {search_query}")
    clean_fallback_title = "".join([c for c in fallback_title if c.isalnum() or c in (' ', '-', '_', '.', '(', ')')]).strip()
    ydl_opts_fallback = ydl_opts_base.copy()
    ydl_opts_fallback['outtmpl'] = os.path.join(output_dir, f"{clean_fallback_title}.%(ext)s")

    try:
        with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
            search_target = f"ytsearch1:{search_query}"
            info_dict = ydl.extract_info(search_target, download=True)
            entries = info_dict.get('entries', [info_dict]) if info_dict and 'entries' in info_dict else [info_dict]
            
            for entry in (entries or []):
                if not entry:
                    continue
                original_filename = ydl.prepare_filename(entry)
                mp3_filename = os.path.splitext(original_filename)[0] + '.mp3'
                base_path = os.path.splitext(original_filename)[0]
                
                thumbnail_path = None
                for ext in ['.webp', '.jpg', '.png', '.jpeg']:
                    test_thumb = base_path + ext
                    if os.path.exists(test_thumb):
                        thumbnail_path = test_thumb
                        break
                
                if not thumbnail_path and custom_thumb_url:
                    try:
                        temp_thumb = base_path + ".jpg"
                        img_data = requests.get(custom_thumb_url, timeout=10).content
                        with open(temp_thumb, 'wb') as handler:
                            handler.write(img_data)
                        thumbnail_path = temp_thumb
                    except Exception:
                        pass

                if thumbnail_path and os.path.exists(mp3_filename):
                    if crop_to_square(thumbnail_path):
                        embed_artwork_manual(mp3_filename, thumbnail_path)
                    try:
                        os.remove(thumbnail_path)
                    except Exception:
                        pass
                
                if os.path.exists(mp3_filename):
                    print(f"✅ Fallback Hybrid Sukses: {mp3_filename}")
                    return
    except Exception as e:
        print(f"❌ Fallback search gagal: {e}")

    # Final check in output directory
    files = [f for f in os.listdir(output_dir) if f.endswith('.mp3')]
    if files:
        latest = sorted(files, key=lambda f: os.path.getmtime(os.path.join(output_dir, f)), reverse=True)[0]
        print(f"✅ Menemukan file MP3 yang berhasil terdownload: {latest}")
        return

    raise Exception("Gagal mengunduh musik setelah mencoba direct dan fallback search.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Penggunaan: python3 music_dl.py <LINK_YOUTUBE_MUSIK>")
        sys.exit(1)

    music_url = sys.argv[1]
    download_music(music_url)

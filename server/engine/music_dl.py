import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from difflib import SequenceMatcher
from io import BytesIO

import requests
import yt_dlp
from PIL import Image, ImageOps


ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
ARTWORK_SIZE = 1200
ITUNES_COUNTRY = os.environ.get("ITUNES_COUNTRY", "ID")
USER_AGENT = "Music-IDL/1.0"
DOWNLOAD_PROXY = os.environ.get("DOWNLOAD_PROXY", "").strip()
DENO_BIN = os.environ.get("DENO_BIN", "deno").strip()
FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg").strip()
ALLOW_REMOTE_COMPONENTS = os.environ.get("ALLOW_REMOTE_COMPONENTS", "false").lower() == "true"
MAX_DURATION_SECONDS = int(os.environ.get("MAX_DURATION_SECONDS", "900"))
MAX_SOURCE_BYTES = int(os.environ.get("MAX_SOURCE_BYTES", str(100 * 1024 * 1024)))

PRESENTATION_NOISE = re.compile(
    r"\b(?:official\s+(?:music\s+)?video|official\s+audio|audio\s+official|"
    r"lyric\s+video|lyrics?|visuali[sz]er|music\s+video|mv|hd|4k)\b",
    re.IGNORECASE,
)
VERSION_PATTERNS = {
    "acoustic": re.compile(r"\bacoustic\b", re.IGNORECASE),
    "demo": re.compile(r"\bdemo\b", re.IGNORECASE),
    "extended": re.compile(r"\bextended(?:\s+(?:mix|version))?\b", re.IGNORECASE),
    "instrumental": re.compile(r"\binstrumental\b", re.IGNORECASE),
    "live": re.compile(r"\blive(?:\s+at|\s+from|\s+in)?\b", re.IGNORECASE),
    "nightcore": re.compile(r"\bnightcore\b", re.IGNORECASE),
    "radio_edit": re.compile(r"\bradio\s+edit\b", re.IGNORECASE),
    "remaster": re.compile(r"\bremaster(?:ed)?(?:\s+\d{2,4})?\b", re.IGNORECASE),
    "remix": re.compile(r"\bremix\b", re.IGNORECASE),
    "slowed": re.compile(r"\bslowed(?:\s*(?:and|&|\+)\s*reverb)?\b", re.IGNORECASE),
    "sped_up": re.compile(r"\bsped\s*up\b", re.IGNORECASE),
}


def log(message):
    print(message, file=sys.stderr, flush=True)


def emit_event(stage, progress):
    payload = json.dumps(
        {"stage": stage, "progress": max(0, min(100, int(progress)))},
        ensure_ascii=True,
    )
    print(f"MUSIC_IDL_EVENT {payload}", file=sys.stderr, flush=True)


def download_progress_hook(status):
    if status.get("status") == "downloading":
        downloaded = status.get("downloaded_bytes") or 0
        total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
        progress = 5 + round((downloaded / total) * 77) if total else 5
        emit_event("downloading", progress)
    elif status.get("status") == "finished":
        emit_event("downloading", 82)


def postprocessor_progress_hook(status):
    if status.get("status") in {"started", "processing"}:
        emit_event("encoding", 88)


def clean_display_text(value):
    if not value:
        return ""
    value = str(value).replace("\u200b", " ").strip()
    return re.sub(r"\s+", " ", value)


def strip_channel_suffix(value):
    value = clean_display_text(value)
    value = re.sub(r"\s+-\s+Topic$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*VEVO$", "", value, flags=re.IGNORECASE)
    return value.strip()


def strip_presentation_noise(value):
    value = clean_display_text(value)
    bracketed_noise = (
        r"[\[(]\s*(?:official\s+(?:music\s+)?video|official\s+audio|audio\s+official|"
        r"lyric\s+video|lyrics?|visuali[sz]er|music\s+video|hd|4k)\s*[\])]"
    )
    value = re.sub(bracketed_noise, " ", value, flags=re.IGNORECASE)
    value = PRESENTATION_NOISE.sub(" ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" -_|()[]")


def normalize_text(value):
    value = strip_presentation_noise(value)
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"\b(?:feat(?:uring)?|ft)\.?\s+.+$", " ", value)
    value = value.replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def version_signature(value):
    value = unicodedata.normalize("NFKD", clean_display_text(value).casefold())
    return frozenset(name for name, pattern in VERSION_PATTERNS.items() if pattern.search(value))


def split_video_title(raw_title, uploader):
    title = strip_presentation_noise(raw_title)
    uploader = strip_channel_suffix(uploader)
    parts = re.split(r"\s+[\-\u2013\u2014]\s+", title, maxsplit=1)
    if len(parts) != 2:
        return title, uploader

    left, right = (part.strip() for part in parts)
    uploader_norm = normalize_text(uploader)
    if uploader_norm and normalize_text(left) == uploader_norm:
        return right, left
    if uploader_norm and normalize_text(right) == uploader_norm:
        return left, right
    if left and right and not uploader_norm:
        return right, left
    return title, uploader


def extract_track_identity(info, fallback=None):
    info = info or {}
    fallback = fallback or {}

    has_structured_title = bool(info.get("track"))
    raw_title = clean_display_text(info.get("track") or info.get("title") or fallback.get("title"))
    artists = info.get("artists") or []
    raw_artist = clean_display_text(
        info.get("artist")
        or (artists[0] if artists else "")
        or info.get("creator")
        or info.get("uploader")
        or fallback.get("author")
    )
    structured = bool(has_structured_title and (info.get("artist") or artists))

    if not structured:
        parsed_source_title = clean_display_text(info.get("title"))
        fallback_title = clean_display_text(fallback.get("title"))
        if fallback_title and (not parsed_source_title or normalize_text(parsed_source_title).startswith("youtube track")):
            raw_title = fallback_title
        raw_title, parsed_artist = split_video_title(raw_title, raw_artist)
        if parsed_artist:
            raw_artist = parsed_artist

    return {
        "title": strip_presentation_noise(raw_title),
        "artist": strip_channel_suffix(raw_artist),
        "album": clean_display_text(info.get("album")),
        "duration": info.get("duration"),
        "version": version_signature(raw_title),
        "confidence": "high" if structured else "medium",
    }


def token_f1(left, right):
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens)
    if not overlap:
        return 0.0
    precision = overlap / len(right_tokens)
    recall = overlap / len(left_tokens)
    return 2 * precision * recall / (precision + recall)


def text_similarity(left, right):
    left = normalize_text(left)
    right = normalize_text(right)
    if not left or not right:
        return 0.0
    return (0.55 * SequenceMatcher(None, left, right).ratio()) + (0.45 * token_f1(left, right))


def is_safe_fallback_match(expected, candidate):
    expected_identity = extract_track_identity({}, expected)
    candidate_identity = extract_track_identity(candidate)
    if not expected_identity["title"] or not candidate_identity["title"]:
        return False
    if expected_identity["version"] != candidate_identity["version"]:
        return False
    if text_similarity(expected_identity["title"], candidate_identity["title"]) < 0.82:
        return False
    if expected_identity["artist"]:
        return text_similarity(
            primary_artist(expected_identity["artist"]),
            primary_artist(candidate_identity["artist"]),
        ) >= 0.72
    return True


def primary_artist(value):
    return re.split(
        r"\s*(?:,|&|\band\b|feat\.?|ft\.?)\s*",
        clean_display_text(value),
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()


def score_itunes_result(identity, result):
    title_similarity = text_similarity(identity["title"], result.get("trackName"))
    artist_similarity = text_similarity(
        primary_artist(identity["artist"]),
        primary_artist(result.get("artistName", "")),
    )

    if title_similarity < 0.88 or artist_similarity < 0.84:
        return None
    if len(normalize_text(identity["title"]).split()) <= 2:
        if normalize_text(identity["title"]) != normalize_text(result.get("trackName")):
            return None
    if identity["version"] != version_signature(result.get("trackName", "")):
        return None

    components = [(title_similarity, 0.58), (artist_similarity, 0.36)]
    duration = identity.get("duration")
    result_duration = result.get("trackTimeMillis")
    if duration and result_duration:
        delta = abs(float(duration) - (float(result_duration) / 1000))
        allowed_delta = max(15.0, float(duration) * 0.08)
        if delta > allowed_delta:
            return None
        components.append((max(0.0, 1.0 - (delta / allowed_delta)), 0.06))

    total_weight = sum(weight for _, weight in components)
    return sum(score * weight for score, weight in components) / total_weight


def apple_release_preference(result):
    album = clean_display_text(result.get("collectionName"))
    album_version = version_signature(album)
    penalty = 0
    if result.get("collectionExplicitness") == "cleaned":
        penalty += 3
    if re.search(r"\b(?:deluxe|anniversary|edition|expanded)\b", album, re.IGNORECASE):
        penalty += 2
    if re.search(r"\b(?:greatest hits|the highlights|compilation|essentials)\b", album, re.IGNORECASE):
        penalty += 4
    if album_version - version_signature(result.get("trackName", "")):
        penalty += 5
    if (result.get("trackCount") or 0) <= 1:
        penalty += 1
    return penalty


def apple_artwork_url(url, size=ARTWORK_SIZE):
    if not url or not url.startswith("https://") or ".mzstatic.com/" not in url:
        return None
    return re.sub(
        r"/\d+x\d+(?:bb)?(?:-[^/.]+)?\.(jpg|jpeg|png)$",
        rf"/{size}x{size}bb.\1",
        url,
        flags=re.IGNORECASE,
    )


def find_apple_music_match(identity):
    if not identity.get("title") or not identity.get("artist"):
        return None

    response = requests.get(
        ITUNES_SEARCH_URL,
        params={
            "term": f'{identity["artist"]} {identity["title"]}',
            "media": "music",
            "entity": "song",
            "country": ITUNES_COUNTRY,
            "limit": 25,
        },
        headers={"User-Agent": USER_AGENT},
        timeout=(5, 10),
    )
    response.raise_for_status()

    candidates = []
    for result in response.json().get("results", []):
        artwork_url = apple_artwork_url(result.get("artworkUrl100"))
        if result.get("kind") != "song" or not artwork_url:
            continue
        score = score_itunes_result(identity, result)
        if score is not None:
            candidates.append((score, result, artwork_url))

    if not candidates:
        return None

    identity_album = normalize_text(identity.get("album"))
    candidates.sort(
        key=lambda candidate: (
            -(text_similarity(identity_album, candidate[1].get("collectionName")) if identity_album else 0),
            -candidate[0],
            apple_release_preference(candidate[1]),
            candidate[1].get("releaseDate") or "9999",
        )
    )
    best_score, best, artwork_url = candidates[0]
    required_score = 0.91 if identity["confidence"] == "high" else 0.94
    if best_score < required_score:
        return None

    if len(candidates) > 1:
        second_score, second, second_artwork_url = candidates[1]
        different_recording = (
            normalize_text(best.get("trackName")) != normalize_text(second.get("trackName"))
            or normalize_text(best.get("artistName")) != normalize_text(second.get("artistName"))
            or abs((best.get("trackTimeMillis") or 0) - (second.get("trackTimeMillis") or 0)) > 3000
        )
        if different_recording and best_score - second_score < 0.03:
            return None
        if not different_recording and artwork_url != second_artwork_url:
            if identity_album:
                best_album_score = text_similarity(identity_album, best.get("collectionName"))
                second_album_score = text_similarity(identity_album, second.get("collectionName"))
                if best_album_score < 0.9:
                    return None
                if abs(best_album_score - second_album_score) < 0.05:
                    best_preference = apple_release_preference(best)
                    second_preference = apple_release_preference(second)
                    same_release = (
                        normalize_text(best.get("collectionName")) == normalize_text(second.get("collectionName"))
                        and best.get("collectionExplicitness") == second.get("collectionExplicitness")
                    )
                    if not same_release and best_preference >= second_preference:
                        return None
            elif apple_release_preference(best) >= apple_release_preference(second):
                return None

    return {"score": best_score, "artwork_url": artwork_url, "result": best}


def download_image(url, destination):
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=(5, 20),
        stream=True,
    )
    response.raise_for_status()

    content = bytearray()
    for chunk in response.iter_content(64 * 1024):
        content.extend(chunk)
        if len(content) > 8 * 1024 * 1024:
            raise ValueError("Artwork melebihi batas 8 MB")

    with Image.open(BytesIO(content)) as image:
        image.verify()
    with open(destination, "wb") as output:
        output.write(content)


def prepare_artwork(image_path, crop=False):
    try:
        if not image_path or not os.path.exists(image_path):
            return False

        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source)
            if crop or image.width != image.height:
                side = min(image.width, image.height)
                left = (image.width - side) // 2
                top = (image.height - side) // 2
                image = image.crop((left, top, left + side, top + side))
            image = image.convert("RGB").resize(
                (ARTWORK_SIZE, ARTWORK_SIZE),
                Image.Resampling.LANCZOS,
            )
            image.save(
                image_path,
                "JPEG",
                quality=90,
                optimize=True,
                progressive=False,
            )
        return True
    except Exception as error:
        log(f"Artwork tidak dapat diproses: {error}")
        return False


def embed_metadata(mp3_path, artwork_path, identity, apple_match=None):
    if not os.path.exists(mp3_path) or not os.path.exists(artwork_path):
        return False

    apple_result = (apple_match or {}).get("result", {})
    title = apple_result.get("trackName") or identity.get("title")
    artist = apple_result.get("artistName") or identity.get("artist")
    album = apple_result.get("collectionName") or identity.get("album")
    temp_mp3 = f"{mp3_path}.tagged.mp3"
    command = [
        FFMPEG_BIN, "-y",
        "-i", mp3_path,
        "-i", artwork_path,
        "-map", "0:a:0",
        "-map", "1:v:0",
        "-c:a", "copy",
        "-c:v", "mjpeg",
        "-id3v2_version", "3",
        "-metadata:s:v", "title=Album cover",
        "-metadata:s:v", "comment=Cover (front)",
        "-disposition:v", "attached_pic",
    ]
    if title:
        command.extend(["-metadata", f"title={title}"])
    if artist:
        command.extend(["-metadata", f"artist={artist}"])
    if album:
        command.extend(["-metadata", f"album={album}"])
    command.append(temp_mp3)

    try:
        subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        os.replace(temp_mp3, mp3_path)
        return True
    except Exception as error:
        log(f"Metadata tidak dapat ditanam: {error}")
        if os.path.exists(temp_mp3):
            os.remove(temp_mp3)
        return False


def locate_thumbnail(base_path):
    for extension in (".webp", ".jpg", ".png", ".jpeg"):
        candidate = base_path + extension
        if os.path.exists(candidate):
            return candidate
    return None


def finalize_download(mp3_path, info, fallback_info=None, custom_thumbnail_url=None):
    emit_event("tagging", 94)
    identity = extract_track_identity(info, fallback_info)
    base_path = os.path.splitext(mp3_path)[0]
    youtube_artwork = locate_thumbnail(base_path)
    apple_artwork = f"{base_path}.apple.jpg"
    artwork_path = None
    apple_match = None
    apple_artwork_ready = False

    try:
        apple_match = find_apple_music_match(identity)
        if apple_match:
            download_image(apple_match["artwork_url"], apple_artwork)
            if prepare_artwork(apple_artwork):
                artwork_path = apple_artwork
                apple_artwork_ready = True
                result = apple_match["result"]
                log(
                    "Apple Music artwork cocok: "
                    f'{result.get("artistName")} - {result.get("trackName")} '
                    f'({apple_match["score"]:.3f})'
                )
    except Exception as error:
        log(f"Pencarian Apple Music artwork gagal, memakai thumbnail YouTube: {error}")

    if not apple_artwork_ready:
        artwork_path = None
        apple_match = None
        if not youtube_artwork and custom_thumbnail_url:
            youtube_artwork = f"{base_path}.fallback.jpg"
            try:
                download_image(custom_thumbnail_url, youtube_artwork)
            except Exception as error:
                log(f"Thumbnail fallback tidak dapat diunduh: {error}")
                youtube_artwork = None
        if youtube_artwork and prepare_artwork(youtube_artwork, crop=True):
            artwork_path = youtube_artwork

    if artwork_path:
        embed_metadata(mp3_path, artwork_path, identity, apple_match)

    for candidate in {youtube_artwork, apple_artwork}:
        if candidate and os.path.exists(candidate):
            try:
                os.remove(candidate)
            except OSError:
                pass


def get_oembed_info(url):
    try:
        response = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        if response.status_code == 200:
            data = response.json()
            return {
                "title": data.get("title", ""),
                "author": data.get("author_name", ""),
                "thumbnail": data.get("thumbnail_url", ""),
            }
    except Exception:
        pass
    return None


def output_template(output_dir):
    return os.path.join(output_dir, "%(title)s [%(id)s].%(ext)s")


def build_ydl_options(output_dir, output_format="mp3", bitrate=192):
    def reject_long_media(info, *, incomplete=False):
        duration = info.get("duration")
        if duration and duration > MAX_DURATION_SECONDS:
            return f"Durasi media melebihi batas {MAX_DURATION_SECONDS} detik"
        return None

    options = {
        "format": (
            "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
            if output_format == "original"
            else "bestaudio/best"
        ),
        "match_filter": reject_long_media,
        "max_filesize": MAX_SOURCE_BYTES,
        "socket_timeout": 30,
        "noplaylist": True,
        "extractor_args": {"youtube": {"player_client": ["android"]}},
        "writethumbnail": output_format == "mp3",
        "outtmpl": output_template(output_dir),
        "quiet": True,
        "noprogress": True,
        "progress_hooks": [download_progress_hook],
    }
    if FFMPEG_BIN:
        options["ffmpeg_location"] = FFMPEG_BIN
    if output_format == "mp3":
        options["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(bitrate),
            },
            {"key": "FFmpegMetadata"},
        ]
        options["postprocessor_hooks"] = [postprocessor_progress_hook]
    if DOWNLOAD_PROXY:
        options["proxy"] = DOWNLOAD_PROXY
    if DENO_BIN:
        options["js_runtimes"] = {"deno": {"path": DENO_BIN}}
    if ALLOW_REMOTE_COMPONENTS:
        options["remote_components"] = ["ejs:github"]
    return options


def find_generated_audio(output_dir, output_format="mp3", video_id=None):
    extensions = {".mp3"} if output_format == "mp3" else {".m4a", ".webm", ".opus"}
    files = [
        os.path.join(output_dir, name)
        for name in os.listdir(output_dir)
        if os.path.splitext(name)[1].lower() in extensions
    ]
    if video_id:
        exact = [path for path in files if f"[{video_id}]" in os.path.basename(path)]
        if exact:
            return exact[0]
    if len(files) == 1:
        return files[0]
    return max(files, key=os.path.getmtime) if files else None


def download_music(url, output_dir, output_format="mp3", bitrate=192):
    os.makedirs(output_dir, exist_ok=True)
    ydl_opts = build_ydl_options(output_dir, output_format, bitrate)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as downloader:
            emit_event("metadata", 2)
            log(f"Mencoba direct download: {url}")
            info = downloader.extract_info(url, download=True)
            if info:
                audio_filename = find_generated_audio(output_dir, output_format, info.get("id"))
                if audio_filename and os.path.exists(audio_filename):
                    if output_format == "mp3":
                        finalize_download(audio_filename, info)
                    return audio_filename
    except Exception as error:
        log(f"Direct download gagal ({error}), mengaktifkan fallback hybrid...")

    oembed = get_oembed_info(url) or {}
    fallback_title = oembed.get("title") or "Audio Track"
    fallback_artist = oembed.get("author") or ""
    search_query = f"{fallback_title} {fallback_artist} audio".strip()
    log(f"Menjalankan pencarian fallback: {search_query}")

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as downloader:
            search_info = downloader.extract_info(f"ytsearch1:{search_query}", download=False)
            entries = search_info.get("entries", []) if search_info else []
            for entry in entries:
                if not entry:
                    continue
                if not is_safe_fallback_match(oembed, entry):
                    log("Hasil fallback ditolak karena identitas lagu tidak cocok.")
                    continue
                fallback_url = entry.get("webpage_url") or entry.get("url")
                if not fallback_url:
                    continue
                downloaded_entry = downloader.extract_info(fallback_url, download=True)
                audio_filename = find_generated_audio(
                    output_dir,
                    output_format,
                    downloaded_entry.get("id"),
                )
                if audio_filename and os.path.exists(audio_filename):
                    if output_format == "mp3":
                        finalize_download(
                            audio_filename,
                            downloaded_entry,
                            oembed,
                            oembed.get("thumbnail"),
                        )
                    return audio_filename
    except Exception as error:
        log(f"Fallback search gagal: {error}")

    raise RuntimeError("Gagal mengunduh musik setelah mencoba direct dan fallback search.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("output_dir", nargs="?")
    parser.add_argument("--format", choices=("mp3", "original"), default="mp3")
    parser.add_argument("--bitrate", choices=(128, 192, 320), type=int, default=192)
    args = parser.parse_args()
    default_output = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output_music")
    output_dir = args.output_dir or default_output
    audio_path = download_music(
        args.url,
        os.path.abspath(output_dir),
        args.format,
        args.bitrate,
    )
    extension = os.path.splitext(audio_path)[1].lower().lstrip(".")
    print(
        json.dumps(
            {
                "status": "ok",
                "file_path": os.path.abspath(audio_path),
                "format": extension,
                "bitrate": args.bitrate if args.format == "mp3" else None,
                "file_size": os.path.getsize(audio_path),
            },
            ensure_ascii=True,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

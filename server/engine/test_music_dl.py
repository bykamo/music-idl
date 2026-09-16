import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path


def load_engine_module():
    sys.modules.setdefault("requests", types.SimpleNamespace())
    sys.modules.setdefault("yt_dlp", types.SimpleNamespace())
    fake_image = types.SimpleNamespace(Resampling=types.SimpleNamespace(LANCZOS=1))
    sys.modules.setdefault("PIL", types.SimpleNamespace(Image=fake_image, ImageOps=types.SimpleNamespace()))

    module_path = Path(__file__).with_name("music_dl.py")
    spec = importlib.util.spec_from_file_location("music_dl_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DownloadOptionsTest(unittest.TestCase):
    def test_options_enforce_duration_without_runtime_remote_downloads(self):
        engine = load_engine_module()
        engine.DOWNLOAD_PROXY = ""
        engine.ALLOW_REMOTE_COMPONENTS = False
        engine.MAX_DURATION_SECONDS = 900

        options = engine.build_ydl_options("/tmp/music-idl-test")

        self.assertNotIn("proxy", options)
        self.assertNotIn("remote_components", options)
        self.assertEqual(options["match_filter"]({"duration": 900}), None)
        self.assertIn("900 detik", options["match_filter"]({"duration": 901}))
        self.assertTrue(options["quiet"])
        self.assertTrue(options["noprogress"])

    def test_proxy_and_remote_components_are_opt_in(self):
        engine = load_engine_module()
        engine.DOWNLOAD_PROXY = "socks5://127.0.0.1:40000"
        engine.ALLOW_REMOTE_COMPONENTS = True

        options = engine.build_ydl_options("/tmp/music-idl-test")

        self.assertEqual(options["proxy"], "socks5://127.0.0.1:40000")
        self.assertEqual(options["remote_components"], ["ejs:github"])

    def test_mp3_mode_uses_requested_bitrate_and_progress_hooks(self):
        engine = load_engine_module()

        options = engine.build_ydl_options("/tmp/music-idl-test", "mp3", 128)

        self.assertEqual(options["format"], "bestaudio/best")
        self.assertEqual(options["postprocessors"][0]["preferredquality"], "128")
        self.assertEqual(len(options["progress_hooks"]), 1)
        self.assertEqual(len(options["postprocessor_hooks"]), 1)

    def test_original_mode_does_not_transcode(self):
        engine = load_engine_module()

        options = engine.build_ydl_options("/tmp/music-idl-test", "original", None)

        self.assertEqual(
            options["format"],
            "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        )
        self.assertNotIn("postprocessors", options)
        self.assertNotIn("postprocessor_hooks", options)
        self.assertFalse(options["writethumbnail"])

    def test_fallback_match_rejects_an_unrelated_recording(self):
        engine = load_engine_module()
        expected = {
            "title": "Numb (Official Music Video)",
            "author": "Linkin Park",
        }

        self.assertTrue(engine.is_safe_fallback_match(expected, {
            "title": "Linkin Park - Numb (Official Audio)",
            "uploader": "Linkin Park",
        }))
        self.assertFalse(engine.is_safe_fallback_match(expected, {
            "title": "Jay-Z and Linkin Park - Numb Encore",
            "uploader": "Random Uploads",
        }))


if __name__ == "__main__":
    unittest.main()

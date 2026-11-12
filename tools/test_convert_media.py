import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import convert_media as converter


class ConversionTests(unittest.TestCase):
    def test_rendition_selection_and_relative_urls(self):
        playlist = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=854x480
../480/index.m3u8
"""
        self.assertEqual(converter.select_variant(playlist, "https://cdn.example/video/master.m3u8"),
                         "https://cdn.example/480/index.m3u8")
        self.assertEqual(converter.select_variant("#EXTM3U\n#EXTINF:5,\nsegment.ts", "https://cdn.example/media.m3u8"),
                         "https://cdn.example/media.m3u8")

    def test_rejects_wrong_codecs_and_truncated_output(self):
        info = {"streams": [{"codec_type": "video", "codec_name": "vp8", "pix_fmt": "yuv420p"},
                            {"codec_type": "audio", "codec_name": "vorbis"}], "format": {"duration": "1000.1"}}
        converter.verify_media(info, 1000)
        for duration in ("995", "NaN", "0", "1010"):
            invalid = copy.deepcopy(info)
            invalid["format"]["duration"] = duration
            with self.assertRaises(RuntimeError):
                converter.verify_media(invalid, 1000)
        info["streams"][0]["codec_name"] = "h264"
        with self.assertRaises(RuntimeError):
            converter.verify_media(info, 1000)

    def test_empty_or_invalid_manifest_does_not_replace_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "catalog.json"
            original = '{"version":1,"videos":{}}\n'
            catalog.write_text(original)
            manifests = root / "manifests"
            manifests.mkdir()
            with patch.object(converter, "ROOT", root), patch.dict("os.environ", {"GITHUB_REPOSITORY": "owner/player"}):
                with self.assertRaises(ValueError):
                    converter.merge(manifests)
                filename = converter.DEMO + ".vp8-vorbis." + "a" * 12 + ".webm"
                record = {"id": converter.DEMO, "file": filename, "sha256": "a" * 64, "bytes": 100,
                          "duration": 12, "videoCodec": "vp8", "audioCodec": "vorbis", "url": "https://example.com/film.webm"}
                (manifests / "demo.json").write_text(json.dumps(record))
                with self.assertRaises(ValueError):
                    converter.merge(manifests)
                self.assertEqual(catalog.read_text(), original)
                record["url"] = f"https://github.com/owner/player/releases/download/{converter.TAG}/{filename}"
                (manifests / "demo.json").write_text(json.dumps(record))
                converter.merge(manifests)
                self.assertEqual(json.loads(catalog.read_text())["videos"][converter.DEMO], record)


if __name__ == "__main__":
    unittest.main()

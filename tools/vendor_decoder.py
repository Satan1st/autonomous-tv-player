import hashlib
import json
from pathlib import Path
import re
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1] / "vendor" / "libmedia"
SITE = "https://zhaohappy.github.io/libmedia/dist/avplayer/"
REVISION = "4bd0fdae"


def download(url, name):
    with urlopen(url, timeout=60) as response:
        data = response.read(12 * 1024 * 1024 + 1)
    if len(data) > 12 * 1024 * 1024 or data.startswith(b"<!DOCTYPE"):
        raise ValueError("Invalid decoder asset: " + name)
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data, {"url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    manifest = {}
    pending = ["avplayer.js"]
    while pending:
        name = pending.pop()
        if name in manifest:
            continue
        data, manifest[name] = download(SITE + name, name)
        text = data.decode("utf-8")
        for chunk in re.findall(r"\.e\((\d+)\)", text):
            pending.append(chunk + ".avplayer.js")
        for filename in re.findall(r"[\d]+\.avplayer\.js", text):
            pending.append(filename)
    for path in ["dist/decode/h264.wasm", "dist/decode/aac.wasm", "dist/resample/resample.wasm",
                 "dist/stretchpitch/stretchpitch.wasm", "dist/cheap-polyfill.js", "COPYING.LGPLv3"]:
        name = path.removeprefix("dist/")
        _, manifest[name] = download(f"https://raw.githubusercontent.com/zhaohappy/libmedia/{REVISION}/{path}", name)
    _, manifest["COPYING.GPLv3"] = download("https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-or-later.txt", "COPYING.GPLv3")
    (ROOT / "manifest.json").write_text(json.dumps({"sourceRevision": REVISION, "files": manifest}, indent=2) + "\n")
    print("Vendored", len(manifest), "decoder/library assets; no media files.")


if __name__ == "__main__":
    main()

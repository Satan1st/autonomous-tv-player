import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCES = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
DEMO = "00000000000000000000000000000000"
TAG = "media-webm-v1"


def fetch(url):
    if urlparse(url).scheme != "https":
        raise ValueError("Only HTTPS sources are supported")
    request = Request(url, headers={"User-Agent": "Autonomous-TV-Converter/1.0", "Accept": "*/*"})
    with urlopen(request, timeout=40) as response:
        data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise ValueError("Unexpectedly large metadata/playlist")
        return data.decode("utf-8-sig"), response.url


def select_variant(playlist, url):
    choices = []
    height = None
    for line in playlist.splitlines():
        line = line.strip()
        if line.startswith("#EXT-X-STREAM-INF:"):
            match = re.search(r"RESOLUTION=\d+x(\d+)", line)
            height = int(match[1]) if match else None
        elif line and not line.startswith("#") and height is not None:
            choices.append((height, urljoin(url, line)))
            height = None
    if not choices:
        return url
    suitable = [entry for entry in choices if entry[0] <= 480]
    return (max(suitable, key=lambda entry: entry[0]) if suitable else min(choices, key=lambda entry: entry[0]))[1]


def resolve_source(video_id):
    text, _ = fetch("https://rutube.ru/api/play/options/" + video_id + "/?format=json")
    options = json.loads(text)
    if not options.get("acl_access", {}).get("allowed"):
        raise RuntimeError("Source is not publicly available to the converter")
    if options.get("drm_token"):
        raise RuntimeError("Encrypted streams are not supported")
    balancer = options.get("video_balancer") or {}
    master = balancer.get("m3u8") or balancer.get("default")
    if not master:
        raise RuntimeError("Source has no HLS stream")
    duration = float(options["duration"]) / 1000
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Source duration is missing or invalid")
    text, final_url = fetch(master)
    if not text.lstrip().startswith("#EXTM3U"):
        raise ValueError("Source did not return an HLS playlist")
    address = select_variant(text, final_url)
    if urlparse(address).scheme != "https":
        raise ValueError("The selected stream must use HTTPS")
    return address, duration


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,codec_name,width,height,pix_fmt:format=duration,size", "-of", "json", str(path)
    ]))


def verify_media(info, expected):
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
    duration = float(info["format"]["duration"])
    if video["codec_name"] != "vp8" or audio["codec_name"] != "vorbis" or video["pix_fmt"] != "yuv420p":
        raise RuntimeError("Output does not use the required stock-CEF codecs")
    if not math.isfinite(duration) or abs(duration - expected) > max(2, expected * 0.001):
        raise RuntimeError(f"Incomplete conversion: expected {expected:.2f}s, got {duration:.2f}s")
    return video, duration


def convert(video_id, output):
    if video_id not in SOURCES:
        raise ValueError("Unknown source ID")
    output.mkdir(parents=True, exist_ok=True)
    source = SOURCES[video_id]
    temporary = output / (video_id + ".partial.webm")
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-y", "-stats_period", "30", "-progress", "pipe:1"]
    if source.get("synthetic"):
        expected = 12
        command += ["-f", "lavfi", "-i", "testsrc2=size=480x270:rate=20:duration=12",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=12", "-map", "0:v:0", "-map", "1:a:0", "-af", "volume=0.1"]
    else:
        address, expected = resolve_source(video_id)
        command += ["-protocol_whitelist", "https,tls,tcp,crypto", "-rw_timeout", "20000000", "-i", address,
                    "-map", "0:v:0", "-map", "0:a:0"]
    command += ["-vf", "scale=w='min(480,iw)':h=-2,fps=20,setsar=1", "-c:v", "libvpx", "-pix_fmt", "yuv420p",
                "-deadline", "good", "-cpu-used", "5", "-threads", "2", "-b:v", "220k", "-crf", "12",
                "-maxrate", "330k", "-bufsize", "660k", "-g", "80", "-auto-alt-ref", "0", "-lag-in-frames", "0",
                "-c:a", "libvorbis", "-ar", "44100", "-ac", "2", "-b:a", "48k", "-map_metadata", "-1", "-f", "webm", str(temporary)]
    print("Converting " + source["title"], flush=True)
    subprocess.run(command, check=True)
    video, duration = verify_media(probe(temporary), expected)
    with temporary.open("rb") as media:
        checksum = hashlib.file_digest(media, "sha256").hexdigest()
    filename = video_id + ".vp8-vorbis." + checksum[:12] + ".webm"
    target = output / filename
    temporary.rename(target)
    metadata = {"id": video_id, "title": source["title"], "file": filename, "sha256": checksum,
                "bytes": target.stat().st_size, "duration": duration, "width": video["width"], "height": video["height"],
                "mime": 'video/webm; codecs="vp8,vorbis"', "videoCodec": "vp8", "audioCodec": "vorbis"}
    (output / (video_id + ".json")).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False), flush=True)


def github(arguments, **kwargs):
    return subprocess.check_output(["gh", *arguments], **kwargs)


def ensure_release(repository):
    result = subprocess.run(["gh", "release", "view", TAG, "--repo", repository], capture_output=True)
    if result.returncode:
        github(["release", "create", TAG, "--repo", repository, "--target", "main", "--title", "WebM television media",
                "--notes", "Prepared VP8/Vorbis media for the television player. Filenames include a SHA-256 content identifier."])


def upload(video_id, output, repository):
    path = output / (video_id + ".json")
    record = json.loads(path.read_text(encoding="utf-8"))
    release = json.loads(github(["api", f"repos/{repository}/releases/tags/{TAG}"]))
    if not any(asset["name"] == record["file"] for asset in release["assets"]):
        github(["release", "upload", TAG, str(output / record["file"]), "--repo", repository])
        release = json.loads(github(["api", f"repos/{repository}/releases/tags/{TAG}"]))
    asset = next(asset for asset in release["assets"] if asset["name"] == record["file"])
    if asset["size"] != record["bytes"]:
        raise RuntimeError("Uploaded asset size differs from the verified output")
    if asset.get("digest") and asset["digest"] != "sha256:" + record["sha256"]:
        raise RuntimeError("GitHub asset checksum differs from the verified output")
    record["url"] = asset["browser_download_url"]
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def merge(manifests):
    path = ROOT / "catalog.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    files = sorted(manifests.glob("*.json"))
    if not files:
        raise ValueError("No successful conversions to publish")
    for file in files:
        record = json.loads(file.read_text(encoding="utf-8"))
        if record["id"] not in SOURCES or record["videoCodec"] != "vp8" or record["audioCodec"] != "vorbis":
            raise ValueError("Invalid media manifest")
        if not re.fullmatch(r"[a-f0-9]{64}", record["sha256"]):
            raise ValueError("Invalid media checksum")
        filename = record["id"] + ".vp8-vorbis." + record["sha256"][:12] + ".webm"
        if record["file"] != filename or record["bytes"] <= 0 or not 0 < record["duration"] <= 43200:
            raise ValueError("Invalid media metadata")
        if record.get("url") != f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/releases/download/{TAG}/{filename}":
            raise ValueError("Unexpected media host")
        catalog["videos"][record["id"]] = record
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["plan", "ensure-release", "convert", "upload", "merge"])
    parser.add_argument("--selection", default="demo")
    parser.add_argument("--id")
    parser.add_argument("--output", type=Path, default=ROOT / "out")
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    args = parser.parse_args()
    if args.action == "plan":
        ids = [key for key in SOURCES if key != DEMO] if args.selection == "all" else [DEMO if args.selection == "demo" else args.selection]
        if any(key not in SOURCES for key in ids):
            raise ValueError("Choose demo, all, or a video ID from sources.json")
        matrix = json.dumps({"id": ids}, separators=(",", ":"))
        print(matrix)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
                output.write("matrix=" + matrix + "\n")
    elif args.action == "ensure-release":
        ensure_release(args.repository)
    elif args.action == "convert":
        convert(args.id, args.output)
    elif args.action == "upload":
        upload(args.id, args.output, args.repository)
    else:
        merge(args.output)

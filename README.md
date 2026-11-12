# AUTONOMOUS TV player

GitHub-hosted television playback for Garry's Mod: GitHub Actions converts the cassette sources to **WebM / VP8 / Vorbis**, GitHub Releases stores the prepared files, and GitHub Pages plays them with a native `<video>` element. The game server sends only the cassette ID, shared time and volume.

Player: https://satan1st.github.io/autonomous-tv-player/

Demo: https://satan1st.github.io/autonomous-tv-player/#v=00000000000000000000000000000000&t=0&volume=0&debug=1

## Convert media

Run **Actions → Convert TV media to WebM → Run workflow** on `main`:

- `demo`: generate and convert a 12-second colour/motion test with a quiet tone;
- `all`: convert the ten films in `sources.json`;
- a listed Rutube ID: convert one cassette.

The workflow resolves the public HLS stream, encodes 480-pixel-wide, 20 fps VP8 video with stereo Vorbis audio, checks codecs and complete duration, hashes the output, and uploads it to release `media-webm-v1`. Only verified, successfully uploaded files enter `catalog.json`. Immutable media filenames contain a content hash; reruns retain earlier versions. Publication deploys Pages explicitly because a bot's catalog commit does not trigger a second workflow.

The film IDs remain the original cassette IDs, including **Хоттабыч (2006)** (`f7b6cb8cdec08dfbda31fbcca2281288`). Conversion happens ahead of playback, not on demand. Source availability from GitHub runners is required when converting.

## Player interface

Open `/#v=<32-character cassette ID>&t=0&volume=0`; optional `paused=1` and `debug=1`.

`window.ixRutube.play()`, `.pause()`, `.volume(0..1)`, `.sync(seconds)` and `.status()` preserve the in-game interface. `READY:rutube` is emitted only once decoded media time actually advances. Native buffering, late joins, paused loading and error states are handled without the Rutube iframe or H.264/AAC.

Important diagnostic codes:

- `MEDIA_NOT_PREPARED`: run conversion for this cassette;
- `CATALOG_UNAVAILABLE`: catalog or manifest could not be loaded;
- `MEDIA_NETWORK`: the release asset could not be fetched;
- `WEBM_UNSUPPORTED` / `MEDIA_DECODE`: the browser could not play VP8/Vorbis;
- `AUTOPLAY_BLOCKED`: a browser requires a click to start playback;
- `PLAYBACK_TIMEOUT`: no playback within 60 seconds.

## Checks

```sh
node player.spec.js
python -m unittest discover -s tools -p 'test_*.py' -v
```

After publishing, Actions also runs `tools/smoke-playback.cjs` in Chromium against the actual Pages URL and every published cassette: HTTP range requests, decoded video/audio, pause, seeking, resume and the readiness signal. Screenshots and JSON results are retained as workflow artifacts. This is browser verification; the in-game CEF/render/audio path still needs a game playtest.

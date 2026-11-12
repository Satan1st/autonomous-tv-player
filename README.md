# AUTONOMOUS TV player

Static HTTPS wrapper for the documented Rutube iframe API, served by GitHub Pages.

Open `/#v=<32-character Rutube video ID>&t=0&volume=0`. Add `&debug=1` for playback diagnostics.

The page exposes `window.ixRutube.play()`, `.pause()`, `.volume(0..1)`, `.sync(seconds)` and `.status()` for the in-game player. It emits `READY:rutube` only after playback starts; diagnostic events use the `IXTV:` console prefix.

This is an HTML wrapper. Video is delivered by Rutube, and the page does not transcode or proxy media. Clients still need support for the codecs offered by the source. The wrapper reports unsupported codecs separately from network/player failures.

API reference: https://rutube.ru/info/embed/

# AUTONOMOUS streaming TV player

GitHub Pages serves the player code and a software H.264/AAC decoder. Films remain on Rutube. The page reads short HLS fragments, decodes them with WebAssembly and renders video/audio inside Garry's Mod's browser. Media is held in a bounded in-memory streaming buffer; no complete film is downloaded, converted ahead of time, uploaded, or stored on GitHub or the game server.

Player: https://satan1st.github.io/autonomous-tv-player/

## In-game integration

The `ix_rutube` service, version **5**, opens `/#v=<Rutube ID>&t=0&volume=0`, with a fresh document query for each playback session. The existing cassette IDs are preserved. `window.ixRutube.play()`, `.pause()`, `.volume(0..1)`, `.sync(seconds)` and `.status()` provide the playback interface.

Rutube does not grant cross-origin JavaScript access to its API/CDN from this Pages origin. The service provides a restricted, read-only **client-side** `DHTML:AddFunction` HTTP transport for HTTPS Rutube/CDN URLs. Fragments travel directly from Rutube to that player's GMod process and into the decoder's RAM. The game server handles only ordinary cassette metadata and shared playback state.

This transport is required: opening the page in an ordinary standalone browser does not provide the native game bridge. No client codec package or browser patch is installed.

## Decoder

Unmodified libmedia `v1.3.1-6-g4bd0fdae` is vendored under `vendor/libmedia`, with baseline H.264/AAC WASM modules and LGPL notices/source references. `canvas-renderer.js` adapts that pinned build to software YUV420-to-RGBA conversion and ordinary Canvas 2D. It explicitly prevents the library's automatic MSE fallback when WebGL is unavailable. WebGL, WebCodecs, MSE, WebGPU, SIMD and shared-memory worker decoding are not required. Initial rendition selection targets 240p, or the lowest available rendition when the source offers nothing at or below 240p, to limit the software-decoding cost on game clients.

`READY:rutube` is emitted after rendered video time advances. `status()` includes software-rendered video/audio frame counts. Add `debug=1` to the URL fragment for diagnostics. `STREAM_UNAVAILABLE` indicates a source/transport failure; `STREAM_DECODE` indicates decoder failure; `PLAYBACK_TIMEOUT` indicates no start within 60 seconds.

## Verification

```sh
node player.spec.js
```

The browser smoke check injects the same native transport interface, streams actual Rutube fragments into RAM, and checks software video/audio rendering, pause, seek, resume and bounded transfer size. Results identify the browser used. Game CEF rendering/performance must also be playtested; passing modern Chromium alone is not proof of stock GMod compatibility.

On 2026-11-12, all ten cassette sources passed this check on **Chromium 86.0.4217.0**: [run 43224547461](https://github.com/Satan1st/autonomous-tv-player/actions/runs/43224547461). Each test streamed at most 4.1 MB of fragments, including a seek to 70% of the film; no film file was saved. This verifies the decoder in a matching Chromium generation, not the live GMod DHTML/native-HTTP integration or the television's in-world rendering.

## Removed approach

The earlier Actions-based whole-film WebM converter was cancelled and removed after the requirement was clarified. Release `media-webm-v1` and its ten generated assets (nine films and a synthetic demo) were deleted. GitHub hosts software only.
